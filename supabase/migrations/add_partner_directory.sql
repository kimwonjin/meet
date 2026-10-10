-- 동맹 관리: 다른 파트너를 회원 구성으로 찾기
-- 파트너마다 회원 수·성별, 성별 연령대(10살 단위), 회원 지역을 한 번에 돌려준다.
-- 개인이 드러나지 않도록 회원이 fn_min_pool_size_for_stats() 명 이상일 때만 연령대·지역을 준다 (파트너 정보 화면과 같은 기준).

CREATE OR REPLACE FUNCTION fn_partner_directory()
RETURNS JSON AS $$
  WITH partners AS (
    SELECT c.id
    FROM connectors c
    JOIN users u ON u.id = c.id
    WHERE c.status = 'approved' AND u.withdrawn_at IS NULL AND u.suspended_at IS NULL
  ),
  members AS (
    SELECT p.id AS connector_id, m.gender, m.age, m.location
    FROM partners p, LATERAL fn_partner_members(p.id) m
  ),
  totals AS (
    SELECT p.id,
           count(m.connector_id) AS total,
           count(*) FILTER (WHERE m.gender = 'M') AS male,
           count(*) FILTER (WHERE m.gender = 'F') AS female
    FROM partners p LEFT JOIN members m ON m.connector_id = p.id
    GROUP BY p.id
  )
  SELECT COALESCE(json_agg(json_build_object(
    'id', t.id,
    'total', t.total,
    'male', t.male,
    'female', t.female,
    'ages', CASE WHEN t.total >= fn_min_pool_size_for_stats() THEN (
      SELECT json_agg(json_build_object('gender', a.gender, 'decade', a.decade, 'count', a.cnt))
      FROM (
        SELECT m.gender, (m.age / 10 * 10) AS decade, count(*) AS cnt
        FROM members m
        WHERE m.connector_id = t.id AND m.age IS NOT NULL AND m.age >= 19 AND m.gender IN ('M', 'F')
        GROUP BY 1, 2
      ) a
    ) END,
    'regions', CASE WHEN t.total >= fn_min_pool_size_for_stats() THEN (
      SELECT json_agg(json_build_object('label', r.label, 'count', r.cnt))
      FROM (
        SELECT m.location AS label, count(*) AS cnt
        FROM members m
        WHERE m.connector_id = t.id AND m.location IS NOT NULL
        GROUP BY 1
      ) r
    ) END
  )), '[]'::json)
  FROM totals t;
$$ LANGUAGE sql STABLE;
