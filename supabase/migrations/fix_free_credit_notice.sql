-- 무료 이용권 알림 문구: 회사명 대신 파트너 이름으로 ("최매니저 파트너님이 소개 1회를 무료로 선물했어요")
CREATE OR REPLACE FUNCTION fn_grant_free_credit(p_connector_id UUID, p_hopeful_id UUID)
RETURNS JSON AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- 내 회원(가입 승인)에게만
  IF NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE connector_id = p_connector_id AND hopeful_id = p_hopeful_id AND status = 'approved') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_member');
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = p_hopeful_id AND (withdrawn_at IS NOT NULL OR suspended_at IS NOT NULL)) THEN
    RETURN json_build_object('ok', false, 'reason', 'inactive');
  END IF;
  BEGIN
    INSERT INTO payments (hopeful_id, connector_id, session_count, amount_total, amount_per_session, sessions_remaining, status, pg_provider, paid_at)
    VALUES (p_hopeful_id, p_connector_id, 1, 0, 0, 1, 'paid', 'free_gift', now());
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'already');
  END;
  SELECT COALESCE(NULLIF(trim(u.name), ''), '담당') INTO v_name FROM users u WHERE u.id = p_connector_id;
  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (p_hopeful_id, 'free_credit', '무료 이용권 1회를 받았어요 🎁', v_name || ' 파트너님이 소개 1회를 무료로 선물했어요', '/connectors');
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;
