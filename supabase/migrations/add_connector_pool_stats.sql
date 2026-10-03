-- 연결자 회원 풀 통계 (Member Pool Statistics) + 동맹 요청/수락/해지
--
-- 배경: 연결자가 동맹매칭을 하려면 상대 연결자의 회원 풀 성격(성별/연령/지역 분포)을
-- 알아야 하지만, 개별 회원 신상은 노출하면 안 된다. 풀 전체의 통계만 제공한다.
--
-- 기존 connector_alliances 테이블(connector_a/connector_b, 데이터 0건, 앱 코드 미참조)은
-- 이번 요청/수락 플로우와 컬럼 구조가 맞지 않아 재설계함.
--
-- 이 마이그레이션이 만드는 것:
-- 1. connector_alliances - 연결자 간 동맹 관계 (PENDING 요청 -> ACTIVE 수락 -> TERMINATED 해지)
-- 2. connector_pool_stats - 일 1회 배치로 집계해 저장하는 스냅샷 테이블
-- 3. fn_min_pool_size_for_stats() - k-익명성 최소 인원 기준 (설정값, 상수 아님)
-- 4. fn_are_allied() - 두 연결자가 활성 동맹인지 판정
-- 5. fn_compute_pool_stats() - 배치 집계 함수 (전체 연결자 대상)
-- 6. fn_get_pool_stats() - 요청자 관계에 따라 범위를 좁혀 반환하는 조회 함수 (서버 측 권한 판정)

DROP TABLE IF EXISTS connector_alliances CASCADE;
DROP TABLE IF EXISTS connector_pool_stats CASCADE;

CREATE TABLE connector_alliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_1_id UUID NOT NULL REFERENCES users(id),
  connector_2_id UUID NOT NULL REFERENCES users(id),
  requested_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'TERMINATED')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX connector_alliances_c1_idx ON connector_alliances(connector_1_id, status);
CREATE INDEX connector_alliances_c2_idx ON connector_alliances(connector_2_id, status);

-- 같은 두 연결자 사이에 PENDING/ACTIVE 관계가 동시에 여러 개 생기는 것을 방지
CREATE UNIQUE INDEX connector_alliances_unique_pair
  ON connector_alliances (LEAST(connector_1_id, connector_2_id), GREATEST(connector_1_id, connector_2_id))
  WHERE status IN ('PENDING', 'ACTIVE');

ALTER TABLE connector_alliances ENABLE ROW LEVEL SECURITY;
CREATE POLICY connector_alliances_allow_all ON connector_alliances FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE connector_pool_stats (
  connector_id UUID PRIMARY KEY REFERENCES users(id),
  total_approved INT NOT NULL DEFAULT 0,
  male_count INT NOT NULL DEFAULT 0,
  female_count INT NOT NULL DEFAULT 0,
  meets_min_pool BOOLEAN NOT NULL DEFAULT false,
  age_distribution JSONB,
  region_distribution JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE connector_pool_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY connector_pool_stats_allow_all ON connector_pool_stats FOR ALL USING (true) WITH CHECK (true);

-- k-익명성 최소 인원 기준. 상수로 코드에 흩어놓지 않고 이 함수 하나만 바꾸면 됨.
CREATE OR REPLACE FUNCTION fn_min_pool_size_for_stats()
RETURNS INT AS $$
  SELECT 10;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_are_allied(a UUID, b UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM connector_alliances
    WHERE status = 'ACTIVE'
      AND ((connector_1_id = a AND connector_2_id = b) OR (connector_1_id = b AND connector_2_id = a))
  );
$$ LANGUAGE sql STABLE;

-- 배치 집계: 모든 연결자에 대해 승인된 소속 희망자 기준으로 통계를 다시 계산해 저장한다.
CREATE OR REPLACE FUNCTION fn_compute_pool_stats()
RETURNS VOID AS $$
DECLARE
  min_size INT := fn_min_pool_size_for_stats();
  c RECORD;
  v_total INT;
  v_male INT;
  v_female INT;
  v_meets BOOLEAN;
  v_age_dist JSONB;
  v_region_dist JSONB;
BEGIN
  FOR c IN SELECT id FROM users WHERE role = 'connector' LOOP
    SELECT
      count(*),
      count(*) FILTER (WHERE u.gender = 'M'),
      count(*) FILTER (WHERE u.gender = 'F')
    INTO v_total, v_male, v_female
    FROM hopeful_requests hr
    JOIN users u ON u.id = hr.hopeful_id
    WHERE hr.connector_id = c.id AND hr.status = 'approved';

    v_meets := v_total >= min_size;
    v_age_dist := NULL;
    v_region_dist := NULL;

    IF v_meets THEN
      SELECT jsonb_object_agg(bucket, pct) INTO v_age_dist
      FROM (
        SELECT
          (floor(date_part('year', age(current_date, u.birth_date::date)) / 10) * 10)::text || '대' AS bucket,
          round(count(*) * 100.0 / v_total, 1) AS pct
        FROM hopeful_requests hr
        JOIN users u ON u.id = hr.hopeful_id
        WHERE hr.connector_id = c.id AND hr.status = 'approved' AND u.birth_date IS NOT NULL
        GROUP BY 1
      ) t;

      SELECT jsonb_agg(jsonb_build_object('label', label, 'pct', pct) ORDER BY pct DESC) INTO v_region_dist
      FROM (
        SELECT
          CASE WHEN rn <= 3 THEN loc ELSE '기타' END AS label,
          round(sum(cnt) * 100.0 / v_total, 1) AS pct
        FROM (
          SELECT u.location AS loc, count(*) AS cnt,
                 row_number() OVER (ORDER BY count(*) DESC) AS rn
          FROM hopeful_requests hr
          JOIN users u ON u.id = hr.hopeful_id
          WHERE hr.connector_id = c.id AND hr.status = 'approved' AND u.location IS NOT NULL
          GROUP BY u.location
        ) ranked
        GROUP BY label
      ) grouped;
    END IF;

    INSERT INTO connector_pool_stats (connector_id, total_approved, male_count, female_count, meets_min_pool, age_distribution, region_distribution, computed_at)
    VALUES (c.id, v_total, v_male, v_female, v_meets, v_age_dist, v_region_dist, now())
    ON CONFLICT (connector_id) DO UPDATE SET
      total_approved = EXCLUDED.total_approved,
      male_count = EXCLUDED.male_count,
      female_count = EXCLUDED.female_count,
      meets_min_pool = EXCLUDED.meets_min_pool,
      age_distribution = EXCLUDED.age_distribution,
      region_distribution = EXCLUDED.region_distribution,
      computed_at = EXCLUDED.computed_at;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 조회: 요청자와 대상 연결자의 관계에 따라 응답 범위를 서버에서 결정한다.
-- (희망자/비로그인은 이번 통계에 접근하지 않음 - 기존 회원수/주요지역 노출은 클라이언트에서 그대로 처리)
CREATE OR REPLACE FUNCTION fn_get_pool_stats(p_target_connector_id UUID, p_requester_id UUID)
RETURNS JSONB AS $$
DECLARE
  requester users%ROWTYPE;
  stats connector_pool_stats%ROWTYPE;
  allied BOOLEAN;
BEGIN
  SELECT * INTO requester FROM users WHERE id = p_requester_id;
  SELECT * INTO stats FROM connector_pool_stats WHERE connector_id = p_target_connector_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'reason', '통계 없음');
  END IF;

  IF requester IS NULL OR requester.role != 'connector' THEN
    RETURN jsonb_build_object('available', false, 'reason', '비공개');
  END IF;

  allied := (p_requester_id = p_target_connector_id) OR fn_are_allied(p_requester_id, p_target_connector_id);

  IF NOT stats.meets_min_pool THEN
    RETURN jsonb_build_object(
      'available', true,
      'meets_min_pool', false,
      'male_count', stats.male_count,
      'female_count', stats.female_count,
      'total_approved', stats.total_approved,
      'computed_at', stats.computed_at
    );
  END IF;

  IF allied THEN
    RETURN jsonb_build_object(
      'available', true,
      'meets_min_pool', true,
      'scope', 'full',
      'male_count', stats.male_count,
      'female_count', stats.female_count,
      'total_approved', stats.total_approved,
      'age_distribution', stats.age_distribution,
      'region_distribution', stats.region_distribution,
      'computed_at', stats.computed_at
    );
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'meets_min_pool', true,
    'scope', 'summary',
    'male_count', stats.male_count,
    'female_count', stats.female_count,
    'total_approved', stats.total_approved,
    'top_age_bucket', (
      SELECT jsonb_build_object('label', key, 'pct', value)
      FROM jsonb_each(stats.age_distribution)
      ORDER BY (value::text)::numeric DESC LIMIT 1
    ),
    'top_region', (
      SELECT elem FROM jsonb_array_elements(stats.region_distribution) elem
      ORDER BY (elem->>'pct')::numeric DESC LIMIT 1
    ),
    'computed_at', stats.computed_at
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 일 1회 배치 스케줄 (pg_cron 확장이 프로젝트에 활성화되어 있어야 함;
-- Supabase 대시보드 Database > Extensions에서 pg_cron 활성화 필요).
-- 활성화 안 되어 있다면 이 부분은 에러가 나므로, 그런 경우 이 문단은 건너뛰고
-- 대신 SELECT fn_compute_pool_stats(); 를 수동으로 실행하거나 별도 스케줄러를 쓸 것.
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('daily-connector-pool-stats', '0 18 * * *', 'SELECT fn_compute_pool_stats();');
