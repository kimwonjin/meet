-- 희망자가 파트너를 고를 때 보는 지표 (파트너 목록·상세)
-- near    : 나와 나이가 비슷한(±5살) 이성 회원 수. 동맹 회원 포함. 5명 미만이면 숫자 대신 near_few = true (개인이 드러나지 않게)
-- recent  : 최근 30일 동안 이 파트너가 제안한 소개 수 (실제로 소개를 하는지)
-- settled : 성사된 만남 수 (노쇼 등 정산 없이 끝난 건 제외)
-- mutual  : 그중 두 회원 모두 애프터를 원한 수
-- 데이터를 바꾸지 않고 읽기만 한다. 실행 전에도 앱은 예전 지표로 동작한다.

CREATE OR REPLACE FUNCTION fn_partner_public_stats(p_gender TEXT, p_age INT)
RETURNS JSON AS $$
  WITH partners AS (
    SELECT c.id
    FROM connectors c JOIN users u ON u.id = c.id
    WHERE c.status = 'approved' AND u.withdrawn_at IS NULL AND u.suspended_at IS NULL
  ),
  near AS (
    SELECT p.id, (
      SELECT count(*) FROM fn_partner_members(p.id, true) m
      WHERE m.gender IN ('M', 'F')
        AND (p_gender IS NULL OR m.gender <> p_gender)
        AND (p_age IS NULL OR (m.age IS NOT NULL AND m.age BETWEEN p_age - 5 AND p_age + 5))
    ) AS cnt
    FROM partners p
  ),
  acts AS (
    SELECT p.id,
      (SELECT count(*) FROM match_requests mr
        WHERE COALESCE(mr.proposer_connector_id, mr.connector_1_id) = p.id
          AND mr.created_at > now() - interval '30 days') AS recent,
      (SELECT count(*) FROM match_requests mr
        WHERE p.id IN (mr.connector_1_id, mr.connector_2_id)
          AND mr.settlement_completed AND mr.closed_reason IS NULL) AS settled,
      (SELECT count(*) FROM match_requests mr
        WHERE p.id IN (mr.connector_1_id, mr.connector_2_id)
          AND mr.settlement_completed AND mr.closed_reason IS NULL
          AND mr.after_care_hopeful_1 = '신청' AND mr.after_care_hopeful_2 = '신청') AS mutual
    FROM partners p
  )
  SELECT COALESCE(json_agg(json_build_object(
    'id', a.id,
    'near', CASE WHEN n.cnt >= 5 THEN n.cnt END,
    'near_few', n.cnt < 5,
    'recent', a.recent,
    'settled', a.settled,
    'mutual', a.mutual
  )), '[]'::json)
  FROM acts a JOIN near n ON n.id = a.id;
$$ LANGUAGE sql STABLE;
