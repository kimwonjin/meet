-- 정책 변경: 희망자도 연결자 선택 시 참고할 수 있도록 요약 통계(성별 + 주요 연령대 1개 + 주요 지역 1개)를 볼 수 있게 한다.
-- (전체 세부 분포는 여전히 동맹 연결자 전용)

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

  IF requester IS NULL OR requester.role NOT IN ('connector', 'hopeful') THEN
    RETURN jsonb_build_object('available', false, 'reason', '비공개');
  END IF;

  -- 희망자는 동맹 개념이 없으므로 항상 요약 범위
  allied := requester.role = 'connector'
    AND ((p_requester_id = p_target_connector_id) OR fn_are_allied(p_requester_id, p_target_connector_id));

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
