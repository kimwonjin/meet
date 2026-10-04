-- 회원이 파트너를 고를 때 보는 정보 (가입 여부 판단용)
-- 1) 파트너 소개·경력 입력란
-- 2) 회원 구성은 그때그때 실제 회원 기준으로 계산 (예전 통계표는 수동 갱신이라 오래된 값이 보였다)
--    연령대는 성별별 5살 단위(초반/후반), 지역은 전체 분포. 개인이 드러나지 않도록 회원이 일정 수 이상일 때만 분포를 보여준다.

-- 회원 구성 분포를 보여주는 최소 회원 수 (초기에는 파트너별 회원이 적어 10명 → 5명으로 낮춤)
CREATE OR REPLACE FUNCTION fn_min_pool_size_for_stats() RETURNS INT AS $$ SELECT 5; $$ LANGUAGE sql IMMUTABLE;

ALTER TABLE connectors ADD COLUMN IF NOT EXISTS intro TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS career TEXT;

-- 가입 승인된 회원 (탈퇴 회원 제외)의 성별·나이·지역
CREATE OR REPLACE FUNCTION fn_partner_members(p_connector_id UUID)
RETURNS TABLE (gender TEXT, age INT, location TEXT) AS $$
  SELECT u.gender::TEXT,
         COALESCE(date_part('year', age(current_date, u.birth_date::date))::INT, u.age::INT),
         NULLIF(trim(u.location), '')
  FROM hopeful_requests hr
  JOIN users u ON u.id = hr.hopeful_id
  WHERE hr.connector_id = p_connector_id AND hr.status = 'approved' AND u.withdrawn_at IS NULL;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_partner_overview(p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  v_min INT := fn_min_pool_size_for_stats();
  v_total INT;
  v_male INT;
  v_female INT;
  v_ages JSON := NULL;
  v_regions JSON := NULL;
  v_settled INT;
  v_mutual INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE m.gender = 'M'), count(*) FILTER (WHERE m.gender = 'F')
  INTO v_total, v_male, v_female FROM fn_partner_members(p_connector_id) m;

  IF v_total >= v_min THEN
    -- 성별별 연령대 (예: 30대 초반 = 30~34세)
    SELECT json_agg(json_build_object('gender', a.gender, 'label', a.label, 'count', a.cnt) ORDER BY a.gender, a.sort_key)
    INTO v_ages
    FROM (
      SELECT m.gender,
             (m.age / 10 * 10)::TEXT || '대 ' || CASE WHEN m.age % 10 < 5 THEN '초반' ELSE '후반' END AS label,
             (m.age / 5) AS sort_key,
             count(*) AS cnt
      FROM fn_partner_members(p_connector_id) m
      WHERE m.age IS NOT NULL AND m.age >= 19 AND m.gender IN ('M', 'F')
      GROUP BY 1, 2, 3
    ) a;

    SELECT json_agg(json_build_object('label', r.label, 'count', r.cnt) ORDER BY r.cnt DESC, r.label)
    INTO v_regions
    FROM (
      SELECT COALESCE(m.location, '미입력') AS label, count(*) AS cnt
      FROM fn_partner_members(p_connector_id) m GROUP BY 1
    ) r;
  END IF;

  SELECT count(*) FILTER (WHERE settlement_completed AND closed_reason IS NULL),
         count(*) FILTER (WHERE settlement_completed AND closed_reason IS NULL AND after_care_hopeful_1 = '신청' AND after_care_hopeful_2 = '신청')
  INTO v_settled, v_mutual
  FROM match_requests
  WHERE p_connector_id IN (connector_1_id, connector_2_id);

  RETURN json_build_object(
    'total', v_total,
    'male', v_male,
    'female', v_female,
    'min_for_detail', v_min,
    'ages', v_ages,
    'regions', v_regions,
    'settled', v_settled,
    'mutual', v_mutual
  );
END;
$$ LANGUAGE plpgsql STABLE;
