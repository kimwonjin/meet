-- 무료 이용권과 환불 수정
-- 1) 환불 가능 금액·환불 처리: 정산과 같은 순서(무료 이용권 먼저)로 진행 중 매칭 몫을 잡는다.
--    예전에는 오래된 유료 이용권을 진행 중 매칭 몫으로 잡아서, 무료를 선물받은 회원이 유료 1회만큼 덜 환불받을 수 있었다.
-- 2) 환불 처리 때 무료 이용권은 지우지 않고 남긴다.
-- 3) 파트너 탈퇴 안내에서 무료 이용권은 '환불받을 수 있어요' 횟수에서 뺀다.

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
    -- 정산과 같은 순서(무료 이용권 먼저)로 진행 중 매칭에 묶일 이용권을 정한다
    ORDER BY connector_id, (pg_provider IS NOT DISTINCT FROM 'free_gift') DESC, created_at ASC, id ASC
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

CREATE OR REPLACE FUNCTION fn_process_refund(p_request_id UUID, p_expected_total NUMERIC)
RETURNS JSON AS $$
DECLARE
  req refund_requests%ROWTYPE;
  v_now JSON;
  v_wallet NUMERIC;
  v_credit NUMERIC := 0;
  p RECORD;
  v_reserved INT;
  v_keep INT;
  v_refund INT;
  v_conn UUID := NULL;
BEGIN
  SELECT * INTO req FROM refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status != 'pending' THEN
    RETURN json_build_object('ok', false, 'reason', 'closed');
  END IF;
  PERFORM fn_lock_user(req.hopeful_id);

  v_now := fn_get_refundable(req.hopeful_id);
  IF (v_now->>'total')::NUMERIC IS DISTINCT FROM p_expected_total THEN
    RETURN json_build_object('ok', false, 'reason', 'amount_changed', 'total', (v_now->>'total')::NUMERIC);
  END IF;

  v_wallet := GREATEST(0, fn_get_wallet_balance(req.hopeful_id));
  FOR p IN
    SELECT * FROM payments
    WHERE hopeful_id = req.hopeful_id AND status = 'paid' AND sessions_remaining > 0
    ORDER BY connector_id, (pg_provider IS NOT DISTINCT FROM 'free_gift') DESC, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_conn IS DISTINCT FROM p.connector_id THEN
      v_conn := p.connector_id;
      v_reserved := fn_reserved_sessions(req.hopeful_id, p.connector_id);
    END IF;
    v_keep := LEAST(p.sessions_remaining, v_reserved);
    v_reserved := v_reserved - v_keep;
    v_refund := p.sessions_remaining - v_keep;
    -- 무료 이용권은 환불하지 않고 그대로 남긴다 (진행 중 매칭 몫은 위에서 이미 셈)
    IF v_refund > 0 AND p.pg_provider IS DISTINCT FROM 'free_gift' THEN
      UPDATE payments
        SET sessions_remaining = sessions_remaining - v_refund,
            refunded_sessions = refunded_sessions + v_refund
        WHERE id = p.id;
      v_credit := v_credit + v_refund * p.amount_per_session;
    END IF;
  END LOOP;

  UPDATE refund_requests
    SET status = 'completed', wallet_amount = v_wallet, credit_amount = v_credit, processed_at = now()
    WHERE id = p_request_id;

  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (req.hopeful_id, 'refund_completed', '환불이 처리되었습니다',
          to_char(v_wallet + v_credit, 'FM999,999,999') || '원을 등록한 계좌로 보내드렸어요', '/profile');

  RETURN json_build_object('ok', true, 'wallet', v_wallet, 'credit', v_credit, 'total', v_wallet + v_credit);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_withdraw_user(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_refundable JSON;
  v_payout NUMERIC;
  r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM match_requests
    WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
      AND (connector_1_id = connector_2_id OR (connector_1_consented AND connector_2_consented))
      AND p_user_id IN (hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id)
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  v_refundable := fn_get_refundable(p_user_id);
  IF (v_refundable->>'total')::NUMERIC > 0
     AND NOT EXISTS (SELECT 1 FROM refund_requests WHERE hopeful_id = p_user_id AND status = 'pending') THEN
    RETURN json_build_object('ok', false, 'reason', 'refund_needed', 'amount', (v_refundable->>'total')::NUMERIC);
  END IF;

  v_payout := fn_connector_available_payout(p_user_id);
  IF v_payout > 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'payout_left', 'amount', v_payout);
  END IF;

  -- 상대 동의를 기다리던 동맹 매칭은 취소
  UPDATE match_requests SET status = 'rejected', closed_reason = 'cancelled'
  WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
    AND p_user_id IN (hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id);

  -- 이 파트너의 이용권이 남은 회원에게 환불 안내
  FOR r IN
    SELECT hopeful_id, SUM(sessions_remaining) AS left_count FROM payments
    WHERE connector_id = p_user_id AND status = 'paid' AND sessions_remaining > 0
      AND pg_provider IS DISTINCT FROM 'free_gift'  -- 무료 이용권은 환불 대상이 아님
    GROUP BY hopeful_id
  LOOP
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (r.hopeful_id, 'partner_withdrawn', '이용하던 파트너가 활동을 종료했어요',
            '남은 이용권 ' || r.left_count || '회는 프로필 › 이용권/결제에서 환불받을 수 있어요', '/profile');
  END LOOP;

  UPDATE users SET
    name = '탈퇴회원',
    phone = 'withdrawn-' || p_user_id::TEXT,
    photo_urls = '{}',
    height = NULL, location = NULL, job = NULL, education = NULL, bio = NULL,
    religion = NULL, smoking = NULL, drinking = NULL, body_type = NULL,
    withdrawn_at = now()
  WHERE id = p_user_id;

  DELETE FROM hopeful_requests WHERE hopeful_id = p_user_id OR connector_id = p_user_id;
  UPDATE connector_alliances SET status = 'TERMINATED', updated_at = now()
    WHERE (connector_1_id = p_user_id OR connector_2_id = p_user_id) AND status != 'TERMINATED';
  DELETE FROM connector_bank_accounts WHERE connector_id = p_user_id;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;
