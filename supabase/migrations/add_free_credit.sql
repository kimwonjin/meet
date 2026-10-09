-- 무료 이용권: 파트너가 자기 회원에게 1회짜리 무료 이용권을 줄 수 있다 (회원 1명당 1번)
-- 결제 기록(payments)에 0원·1회짜리로 남기고 pg_provider = 'free_gift' 로 구분한다.
-- 무료 이용권으로 성사된 매칭은 정산금 0원 (파트너 부담, 회사 수수료 없음). 환불 대상 아님.

-- 같은 회원에게 두 번 줄 수 없다 (동시에 눌러도 한 번만)
CREATE UNIQUE INDEX IF NOT EXISTS payments_free_gift_once ON payments (hopeful_id, connector_id) WHERE pg_provider = 'free_gift';

-- 이미 무료 이용권을 준 내 회원 목록
CREATE OR REPLACE FUNCTION fn_free_credit_given(p_connector_id UUID)
RETURNS JSON AS $$
  SELECT COALESCE(json_agg(hopeful_id), '[]'::json) FROM payments
  WHERE connector_id = p_connector_id AND pg_provider = 'free_gift';
$$ LANGUAGE sql STABLE;

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
  SELECT COALESCE(c.business_name, u.name, '파트너') INTO v_name FROM users u LEFT JOIN connectors c ON c.id = u.id WHERE u.id = p_connector_id;
  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (p_hopeful_id, 'free_credit', '무료 이용권 1회를 받았어요 🎁', v_name || '에서 소개 1회를 무료로 선물했어요', '/connectors');
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- 정산: 무료 이용권을 먼저 쓴다 (나머지는 예전처럼 먼저 산 것부터)
CREATE OR REPLACE FUNCTION fn_settle_match(p_match_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  m match_requests%ROWTYPE;
  v_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match_requests WHERE id = p_match_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '매칭을 찾을 수 없습니다: %', p_match_id;
  END IF;

  IF m.settlement_completed THEN
    RETURN false;
  END IF;

  -- 취소(거절)된 매칭은 마무리·정산하지 않는다
  IF m.status = 'rejected' THEN
    RETURN false;
  END IF;

  IF m.meeting_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION '만남이 완료된 매칭만 마무리할 수 있습니다';
  END IF;

  -- 노쇼 신고: 정산 없이 종료
  IF m.after_care_hopeful_1 = '노쇼신고' OR m.after_care_hopeful_2 = '노쇼신고' THEN
    UPDATE match_requests
      SET settlement_completed = true, settlement_completed_at = now(), closed_reason = 'no_show'
      WHERE id = p_match_id;

    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (m.connector_1_id, 'match_closed_no_show', '노쇼 신고로 매칭이 종료되었습니다', '정산 없이 종료되었고 회원 이용권은 차감되지 않았습니다', '/matching');
    IF m.connector_2_id != m.connector_1_id THEN
      INSERT INTO notifications (user_id, type, title, body, deep_link_route)
      VALUES (m.connector_2_id, 'match_closed_no_show', '노쇼 신고로 매칭이 종료되었습니다', '정산 없이 종료되었고 회원 이용권은 차감되지 않았습니다', '/matching');
    END IF;
    RETURN true;
  END IF;

  IF m.after_care_hopeful_1 IS NULL OR m.after_care_hopeful_2 IS NULL THEN
    RAISE EXCEPTION '양측 애프터의사가 모두 제출되어야 정산할 수 있습니다';
  END IF;

  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_1_id AND connector_id = m.connector_1_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY (pg_provider IS NOT DISTINCT FROM 'free_gift') DESC, created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '회원(%)의 남은 이용권이 없습니다', m.hopeful_1_id;
  END IF;
  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;
  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout, status, settled_at)
  VALUES (p_match_id, m.hopeful_1_id, m.connector_1_id, v_payment.id,
    v_payment.amount_per_session, ROUND(v_payment.amount_per_session * 0.20), ROUND(v_payment.amount_per_session * 0.80), 'paid', now());

  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_2_id AND connector_id = m.connector_2_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY (pg_provider IS NOT DISTINCT FROM 'free_gift') DESC, created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '회원(%)의 남은 이용권이 없습니다', m.hopeful_2_id;
  END IF;
  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;
  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout, status, settled_at)
  VALUES (p_match_id, m.hopeful_2_id, m.connector_2_id, v_payment.id,
    v_payment.amount_per_session, ROUND(v_payment.amount_per_session * 0.20), ROUND(v_payment.amount_per_session * 0.80), 'paid', now());

  UPDATE match_requests SET settlement_completed = true, settlement_completed_at = now() WHERE id = p_match_id;

  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (m.connector_1_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');
  IF m.connector_2_id != m.connector_1_id THEN
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (m.connector_2_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');
  END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 환불 가능 금액: 무료 이용권은 횟수에서 뺀다 (금액은 원래 0원)
CREATE OR REPLACE FUNCTION fn_get_refundable(p_hopeful_id UUID)
RETURNS JSON AS $$
DECLARE
  v_wallet NUMERIC := GREATEST(0, fn_get_wallet_balance(p_hopeful_id));
  v_credit NUMERIC := 0;
  v_sessions INT := 0;
  p RECORD;
  v_reserved INT;
  v_keep INT;
  v_conn UUID := NULL;
BEGIN
  FOR p IN
    SELECT * FROM payments
    WHERE hopeful_id = p_hopeful_id AND status = 'paid' AND sessions_remaining > 0
    ORDER BY connector_id, created_at ASC, id ASC
  LOOP
    IF v_conn IS DISTINCT FROM p.connector_id THEN
      v_conn := p.connector_id;
      v_reserved := fn_reserved_sessions(p_hopeful_id, p.connector_id);
    END IF;
    v_keep := LEAST(p.sessions_remaining, v_reserved);
    v_reserved := v_reserved - v_keep;
    -- 무료 이용권은 환불 대상이 아니므로 환불 가능 횟수에서 뺀다 (진행 중 매칭 예약에는 그대로 쓴다)
    IF p.amount_per_session > 0 THEN
      v_sessions := v_sessions + (p.sessions_remaining - v_keep);
    END IF;
    v_credit := v_credit + (p.sessions_remaining - v_keep) * p.amount_per_session;
  END LOOP;

  RETURN json_build_object('wallet', v_wallet, 'credit', v_credit, 'sessions', v_sessions, 'total', v_wallet + v_credit);
END;
$$ LANGUAGE plpgsql STABLE;

