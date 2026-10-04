-- 파트너 상세에 '동맹 포함 회원 구성'도 보여준다.
-- 동맹 매칭으로 동맹 파트너의 회원과도 만날 수 있으므로, 회원이 만날 수 있는 전체 범위를 알려준다.
-- p_include_allies = true 이면 이 파트너 + 활성 동맹 파트너들의 회원 (같은 사람은 한 번만)

DROP FUNCTION IF EXISTS fn_partner_overview(UUID);
DROP FUNCTION IF EXISTS fn_partner_members(UUID);

CREATE OR REPLACE FUNCTION fn_partner_members(p_connector_id UUID, p_include_allies BOOLEAN DEFAULT false)
RETURNS TABLE (gender TEXT, age INT, location TEXT) AS $$
  SELECT u.gender::TEXT,
         COALESCE(date_part('year', age(current_date, u.birth_date::date))::INT, u.age::INT),
         NULLIF(trim(u.location), '')
  FROM users u
  WHERE u.withdrawn_at IS NULL
    AND u.id IN (
      SELECT hr.hopeful_id FROM hopeful_requests hr
      WHERE hr.status = 'approved'
        AND (hr.connector_id = p_connector_id
          OR (p_include_allies AND hr.connector_id IN (
                SELECT CASE WHEN a.connector_1_id = p_connector_id THEN a.connector_2_id ELSE a.connector_1_id END
                FROM connector_alliances a
                WHERE a.status = 'ACTIVE' AND p_connector_id IN (a.connector_1_id, a.connector_2_id))))
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_partner_overview(p_connector_id UUID, p_include_allies BOOLEAN DEFAULT false)
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
  v_allies INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE m.gender = 'M'), count(*) FILTER (WHERE m.gender = 'F')
  INTO v_total, v_male, v_female FROM fn_partner_members(p_connector_id, p_include_allies) m;

  IF v_total >= v_min THEN
    SELECT json_agg(json_build_object('gender', a.gender, 'label', a.label, 'count', a.cnt) ORDER BY a.gender, a.sort_key)
    INTO v_ages
    FROM (
      SELECT m.gender,
             (m.age / 10 * 10)::TEXT || '대 ' || CASE WHEN m.age % 10 < 5 THEN '초반' ELSE '후반' END AS label,
             (m.age / 5) AS sort_key,
             count(*) AS cnt
      FROM fn_partner_members(p_connector_id, p_include_allies) m
      WHERE m.age IS NOT NULL AND m.age >= 19 AND m.gender IN ('M', 'F')
      GROUP BY 1, 2, 3
    ) a;

    SELECT json_agg(json_build_object('label', r.label, 'count', r.cnt) ORDER BY r.cnt DESC, r.label)
    INTO v_regions
    FROM (
      SELECT COALESCE(m.location, '미입력') AS label, count(*) AS cnt
      FROM fn_partner_members(p_connector_id, p_include_allies) m GROUP BY 1
    ) r;
  END IF;

  SELECT count(*) FILTER (WHERE settlement_completed AND closed_reason IS NULL),
         count(*) FILTER (WHERE settlement_completed AND closed_reason IS NULL AND after_care_hopeful_1 = '신청' AND after_care_hopeful_2 = '신청')
  INTO v_settled, v_mutual
  FROM match_requests
  WHERE p_connector_id IN (connector_1_id, connector_2_id);

  SELECT count(*) INTO v_allies FROM connector_alliances
  WHERE status = 'ACTIVE' AND p_connector_id IN (connector_1_id, connector_2_id);

  RETURN json_build_object(
    'total', v_total, 'male', v_male, 'female', v_female,
    'min_for_detail', v_min,
    'ages', v_ages, 'regions', v_regions,
    'settled', v_settled, 'mutual', v_mutual,
    'ally_count', v_allies
  );
END;
$$ LANGUAGE plpgsql STABLE;
