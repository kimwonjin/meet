-- 파트너 지표 개인정보 보완
-- 예전 함수는 성별·나이를 아무 값으로나 넣을 수 있어, 나이를 1살씩 바꿔 조회하면 회원 나이를 알아낼 수 있었다.
-- 이제 조회하는 회원의 id만 받고, 그 회원의 성별·나이를 서버가 직접 읽는다.
-- 나이도 5살 단위 구간으로만 계산한다 (회원 구성 통계와 같은 단위).
-- 데이터를 바꾸지 않는다. 실행 전에도 앱은 예전 지표로 동작한다.

DROP FUNCTION IF EXISTS fn_partner_public_stats(TEXT, INT);

CREATE OR REPLACE FUNCTION fn_partner_public_stats(p_viewer_id UUID)
RETURNS JSON AS $$
  WITH me AS (
    SELECT u.gender::TEXT AS gender,
           (COALESCE(date_part('year', age(current_date, u.birth_date::date))::INT, u.age::INT) / 5) * 5 AS band
    FROM users u WHERE u.id = p_viewer_id
  ),
  partners AS (
    SELECT c.id
    FROM connectors c JOIN users u ON u.id = c.id
    WHERE c.status = 'approved' AND u.withdrawn_at IS NULL AND u.suspended_at IS NULL
  ),
  near AS (
    SELECT p.id, (
      SELECT count(*) FROM fn_partner_members(p.id, true) m, me
      WHERE m.gender IN ('M', 'F')
        AND (me.gender IS NULL OR m.gender <> me.gender)
        -- 내 나이 구간(5살)과 그 앞뒤 구간: 예) 31살 → 25~39살
        AND (me.band IS NULL OR (m.age IS NOT NULL AND m.age BETWEEN me.band - 5 AND me.band + 9))
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

-- 애프터 의사를 기한 안에 답하지 않아 자동으로 '미신청'이 된 경우를 구분한다 (파트너에게 '답하지 않음'으로 보여주기 위해)
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS after_care_auto_1 BOOLEAN DEFAULT false;
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS after_care_auto_2 BOOLEAN DEFAULT false;
