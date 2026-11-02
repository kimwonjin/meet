-- 파트너별 회원 수에서 이용 정지된 회원도 뺀다 (탈퇴 회원은 이미 빠져 있음)
-- 앱의 동맹 회원 목록·홈의 '동맹 회원 n명'과 같은 기준으로 맞춘다
CREATE OR REPLACE FUNCTION fn_partner_members(p_connector_id UUID, p_include_allies BOOLEAN DEFAULT false)
RETURNS TABLE (gender TEXT, age INT, location TEXT) AS $$
  SELECT u.gender::TEXT,
         COALESCE(date_part('year', age(current_date, u.birth_date::date))::INT, u.age::INT),
         NULLIF(trim(u.location), '')
  FROM users u
  WHERE u.withdrawn_at IS NULL
    AND u.suspended_at IS NULL
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
