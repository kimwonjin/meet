-- 무료 이용권 횟수를 파트너가 정한다 (1·2·3·5회 중 고름, 최대 5회)
-- 회원 1명당 한 번만 줄 수 있는 규칙은 그대로다 (payments_free_gift_once).
-- 최대 5회: 파트너가 회원에게 현금을 따로 받고 무료 이용권으로 소개해 수수료를 피하는 일을 줄이려는 상한.

-- 예전 함수(횟수 없음)를 지워야 같은 이름의 새 함수와 헷갈리지 않는다
DROP FUNCTION IF EXISTS fn_grant_free_credit(UUID, UUID);

-- 앱이 '횟수 고르기'를 보여줘도 되는지 확인하는 용도
CREATE OR REPLACE FUNCTION fn_free_credit_max()
RETURNS INT AS $$ SELECT 5 $$ LANGUAGE sql IMMUTABLE;

-- 이미 무료 이용권을 준 내 회원과 준 횟수
CREATE OR REPLACE FUNCTION fn_free_credit_given(p_connector_id UUID)
RETURNS JSON AS $$
  SELECT COALESCE(json_agg(json_build_object('hopeful_id', hopeful_id, 'count', session_count)), '[]'::json) FROM payments
  WHERE connector_id = p_connector_id AND pg_provider = 'free_gift';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_grant_free_credit(p_connector_id UUID, p_hopeful_id UUID, p_count INT DEFAULT 1)
RETURNS JSON AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > fn_free_credit_max() THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_count');
  END IF;
  -- 내 회원(가입 승인)에게만
  IF NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE connector_id = p_connector_id AND hopeful_id = p_hopeful_id AND status = 'approved') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_member');
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = p_hopeful_id AND (withdrawn_at IS NOT NULL OR suspended_at IS NOT NULL)) THEN
    RETURN json_build_object('ok', false, 'reason', 'inactive');
  END IF;
  BEGIN
    INSERT INTO payments (hopeful_id, connector_id, session_count, amount_total, amount_per_session, sessions_remaining, status, pg_provider, paid_at)
    VALUES (p_hopeful_id, p_connector_id, p_count, 0, 0, p_count, 'paid', 'free_gift', now());
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'already');
  END;
  SELECT COALESCE(NULLIF(trim(u.name), ''), '담당') INTO v_name FROM users u WHERE u.id = p_connector_id;
  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (p_hopeful_id, 'free_credit', '무료 이용권 ' || p_count || '회를 받았어요 🎁',
          v_name || ' 파트너님이 소개 ' || p_count || '회를 무료로 선물했어요', '/connectors');
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;
