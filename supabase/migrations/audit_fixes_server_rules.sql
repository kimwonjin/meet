-- 전체 점검(감사)에서 나온 서버 측 수정
-- 돈·매칭 상태를 바꾸는 동작은 화면이 아니라 서버 함수 안에서 한 번에 확인하고 처리한다
-- (빠른 두 번 클릭, 두 기기 동시 사용, 오래된 화면에서 누른 버튼으로 생기는 문제 방지)

-- ─────────────────────────────────────────────
-- 1. 진행 중 매칭이 묶어둔 이용권
--    상대 파트너가 아직 동의하지 않은 동맹 매칭은 회원에게 보이지도 않으므로 묶지 않는다
--    (동의하는 순간 fn_consent_match에서 이용권을 다시 확인한다)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_reserved_sessions(p_hopeful_id UUID, p_connector_id UUID)
RETURNS INT AS $$
  SELECT count(*)::INT FROM match_requests
  WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
    AND (connector_1_id = connector_2_id OR (connector_1_consented AND connector_2_consented))
    AND ((hopeful_1_id = p_hopeful_id AND connector_1_id = p_connector_id)
      OR (hopeful_2_id = p_hopeful_id AND connector_2_id = p_connector_id));
$$ LANGUAGE sql STABLE;

-- 새 매칭에 쓸 수 있는 이용권 = 남은 이용권 - 진행 중 매칭에 묶인 이용권
CREATE OR REPLACE FUNCTION fn_available_credit(p_hopeful_id UUID, p_connector_id UUID)
RETURNS INT AS $$
  SELECT GREATEST(0,
    COALESCE((SELECT SUM(sessions_remaining) FROM payments
              WHERE hopeful_id = p_hopeful_id AND connector_id = p_connector_id AND status = 'paid'), 0)::INT
    - fn_reserved_sessions(p_hopeful_id, p_connector_id));
$$ LANGUAGE sql STABLE;

-- 회원 한 명의 돈·이용권을 바꾸는 작업은 동시에 하나만 (구매·환불 처리·매칭 제안)
CREATE OR REPLACE FUNCTION fn_lock_user(p_user_id UUID)
RETURNS VOID AS $$
  SELECT pg_advisory_xact_lock(hashtext('user:' || p_user_id::TEXT));
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────
-- 2. 이용권 구매: 잔액·요금 확인과 결제 기록을 한 번에
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_purchase_package(p_hopeful_id UUID, p_connector_id UUID, p_session_count INT, p_expected_fee NUMERIC)
RETURNS JSON AS $$
DECLARE
  v_fee NUMERIC;
  v_total NUMERIC;
  v_balance NUMERIC;
  v_id UUID;
BEGIN
  IF p_session_count IS NULL OR p_session_count <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM fn_lock_user(p_hopeful_id);

  IF NOT EXISTS (SELECT 1 FROM hopeful_requests
                 WHERE hopeful_id = p_hopeful_id AND connector_id = p_connector_id AND status = 'approved') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_member');
  END IF;

  SELECT fee_per_session INTO v_fee FROM connectors WHERE id = p_connector_id;
  IF v_fee IS NULL OR v_fee <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_fee');
  END IF;
  IF p_expected_fee IS DISTINCT FROM v_fee THEN
    RETURN json_build_object('ok', false, 'reason', 'fee_changed', 'fee', v_fee);
  END IF;

  v_total := v_fee * p_session_count;
  v_balance := fn_get_wallet_balance(p_hopeful_id);
  IF v_balance < v_total THEN
    RETURN json_build_object('ok', false, 'reason', 'insufficient', 'balance', v_balance, 'total', v_total);
  END IF;

  INSERT INTO payments (hopeful_id, connector_id, session_count, amount_total, amount_per_session, sessions_remaining, status, pg_provider, paid_at)
  VALUES (p_hopeful_id, p_connector_id, p_session_count, v_total, v_fee, p_session_count, 'paid', 'mock', now())
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'total', v_total);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 3. 매칭 제안 / 동맹 동의 / 매칭 취소
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_propose_match(p_proposer_id UUID, p_hopeful_1 UUID, p_connector_1 UUID, p_hopeful_2 UUID, p_connector_2 UUID)
RETURNS JSON AS $$
DECLARE
  v_id UUID;
  v_internal BOOLEAN := p_connector_1 = p_connector_2;
BEGIN
  IF p_hopeful_1 = p_hopeful_2 THEN
    RETURN json_build_object('ok', false, 'reason', 'same_member');
  END IF;
  -- 제안하는 파트너의 회원이 반드시 한 명 이상 포함되어야 한다
  IF p_proposer_id NOT IN (p_connector_1, p_connector_2) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_your_member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE hopeful_id = p_hopeful_1 AND connector_id = p_connector_1 AND status = 'approved')
     OR NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE hopeful_id = p_hopeful_2 AND connector_id = p_connector_2 AND status = 'approved') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_member');
  END IF;
  IF NOT v_internal AND NOT EXISTS (
    SELECT 1 FROM connector_alliances
    WHERE status = 'ACTIVE'
      AND ((connector_1_id = p_connector_1 AND connector_2_id = p_connector_2) OR (connector_1_id = p_connector_2 AND connector_2_id = p_connector_1))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'no_alliance');
  END IF;

  -- 두 회원을 같은 순서로 잠가 교착을 피한다
  PERFORM fn_lock_user(LEAST(p_hopeful_1, p_hopeful_2));
  PERFORM fn_lock_user(GREATEST(p_hopeful_1, p_hopeful_2));

  IF EXISTS (
    SELECT 1 FROM match_requests
    WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
      AND ((hopeful_1_id = p_hopeful_1 AND hopeful_2_id = p_hopeful_2) OR (hopeful_1_id = p_hopeful_2 AND hopeful_2_id = p_hopeful_1))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'duplicate');
  END IF;

  IF fn_available_credit(p_hopeful_1, p_connector_1) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', p_hopeful_1);
  END IF;
  IF fn_available_credit(p_hopeful_2, p_connector_2) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', p_hopeful_2);
  END IF;

  INSERT INTO match_requests (hopeful_1_id, connector_1_id, hopeful_2_id, connector_2_id, status, proposer_connector_id, connector_1_consented, connector_2_consented)
  VALUES (p_hopeful_1, p_connector_1, p_hopeful_2, p_connector_2, 'pending', p_proposer_id,
          v_internal OR p_connector_1 = p_proposer_id, v_internal OR p_connector_2 = p_proposer_id)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'needs_consent', NOT v_internal);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_consent_match(p_match_id UUID, p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  m match_requests%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match_requests WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR m.status = 'rejected' OR m.settlement_completed THEN
    RETURN json_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF NOT ((m.connector_1_id = p_connector_id AND NOT m.connector_1_consented)
       OR (m.connector_2_id = p_connector_id AND NOT m.connector_2_consented)) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_needed');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM connector_alliances
    WHERE status = 'ACTIVE'
      AND ((connector_1_id = m.connector_1_id AND connector_2_id = m.connector_2_id) OR (connector_1_id = m.connector_2_id AND connector_2_id = m.connector_1_id))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'no_alliance');
  END IF;

  PERFORM fn_lock_user(LEAST(m.hopeful_1_id, m.hopeful_2_id));
  PERFORM fn_lock_user(GREATEST(m.hopeful_1_id, m.hopeful_2_id));
  IF fn_available_credit(m.hopeful_1_id, m.connector_1_id) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', m.hopeful_1_id);
  END IF;
  IF fn_available_credit(m.hopeful_2_id, m.connector_2_id) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', m.hopeful_2_id);
  END IF;

  UPDATE match_requests SET
    connector_1_consented = connector_1_consented OR connector_1_id = p_connector_id,
    connector_2_consented = connector_2_consented OR connector_2_id = p_connector_id
  WHERE id = p_match_id;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- 만남 완료 전까지는 담당 파트너 누구나 매칭을 취소(거절)할 수 있다. 묶여 있던 이용권은 풀린다.
CREATE OR REPLACE FUNCTION fn_cancel_match(p_match_id UUID, p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  m match_requests%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match_requests WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR m.status = 'rejected' OR m.settlement_completed THEN
    RETURN json_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF p_connector_id NOT IN (m.connector_1_id, m.connector_2_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_yours');
  END IF;
  IF m.meeting_status = 'completed' THEN
    RETURN json_build_object('ok', false, 'reason', 'meeting_done');
  END IF;
  UPDATE match_requests SET status = 'rejected', closed_reason = 'cancelled' WHERE id = p_match_id;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 4. 정산: 이번 호출에서 실제로 마무리했는지 돌려준다 (중복 알림 방지)
--    노쇼 신고는 만남 완료 이후에만 인정한다
-- ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS fn_settle_match(UUID);
CREATE FUNCTION fn_settle_match(p_match_id UUID)
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
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
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
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
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

-- ─────────────────────────────────────────────
-- 5. 파트너 출금 신청: 출금 가능 금액 확인과 기록을 한 번에
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_connector_available_payout(p_connector_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE((SELECT SUM(connector_payout) FROM settlements WHERE connector_id = p_connector_id AND status = 'paid'), 0)
       - COALESCE((SELECT SUM(amount) FROM withdrawal_requests WHERE connector_id = p_connector_id), 0);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_request_withdrawal(p_connector_id UUID, p_amount NUMERIC, p_bank_name TEXT, p_account_number TEXT, p_account_holder TEXT)
RETURNS JSON AS $$
DECLARE
  v_available NUMERIC;
BEGIN
  PERFORM fn_lock_user(p_connector_id);
  v_available := fn_connector_available_payout(p_connector_id);
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF p_amount > v_available THEN
    RETURN json_build_object('ok', false, 'reason', 'exceeds', 'available', v_available);
  END IF;
  INSERT INTO withdrawal_requests (connector_id, amount, bank_name, account_number, account_holder)
  VALUES (p_connector_id, p_amount, p_bank_name, p_account_number, p_account_holder);
  RETURN json_build_object('ok', true, 'available', v_available - p_amount);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 6. 환불: 대기 중 요청은 한 명당 1건, 운영자가 본 금액과 처리 금액이 다르면 멈춘다
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_pending ON refund_requests(hopeful_id) WHERE status = 'pending';

DROP FUNCTION IF EXISTS fn_process_refund(UUID);
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
    ORDER BY connector_id, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_conn IS DISTINCT FROM p.connector_id THEN
      v_conn := p.connector_id;
      v_reserved := fn_reserved_sessions(req.hopeful_id, p.connector_id);
    END IF;
    v_keep := LEAST(p.sessions_remaining, v_reserved);
    v_reserved := v_reserved - v_keep;
    v_refund := p.sessions_remaining - v_keep;
    IF v_refund > 0 THEN
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

-- ─────────────────────────────────────────────
-- 7. 탈퇴: 상대 동의 전 동맹 매칭은 막지 않고 함께 취소, 파트너 탈퇴 시 남은 이용권 회원에게 환불 안내
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- 8. 채팅 읽음 시각은 서버 시계로 (휴대폰 시계가 틀려도 안 읽은 수가 맞도록)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_mark_thread_read(p_thread_id UUID, p_user_id UUID)
RETURNS VOID AS $$
  UPDATE chat_threads SET
    p1_last_read_at = CASE WHEN participant_1_id = p_user_id THEN now() ELSE p1_last_read_at END,
    p2_last_read_at = CASE WHEN participant_2_id = p_user_id THEN now() ELSE p2_last_read_at END
  WHERE id = p_thread_id;
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────
-- 9. 동맹 해지: 아직 상대 동의를 기다리던 동맹 매칭도 함께 닫는다
--    (양쪽이 동의해 진행 중인 매칭은 그대로 끝까지 진행)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_terminate_alliance(p_alliance_id UUID, p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  a connector_alliances%ROWTYPE;
  v_closed INT;
BEGIN
  SELECT * INTO a FROM connector_alliances WHERE id = p_alliance_id FOR UPDATE;
  IF NOT FOUND OR p_connector_id NOT IN (a.connector_1_id, a.connector_2_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_yours');
  END IF;
  IF a.status = 'TERMINATED' THEN
    RETURN json_build_object('ok', false, 'reason', 'closed');
  END IF;

  UPDATE connector_alliances SET status = 'TERMINATED', updated_at = now() WHERE id = p_alliance_id;

  UPDATE match_requests SET status = 'rejected', closed_reason = 'cancelled'
  WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
    AND NOT (connector_1_consented AND connector_2_consented)
    AND ((connector_1_id = a.connector_1_id AND connector_2_id = a.connector_2_id)
      OR (connector_1_id = a.connector_2_id AND connector_2_id = a.connector_1_id));
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN json_build_object('ok', true, 'was_pending', a.status = 'PENDING', 'closed_matches', v_closed);
END;
$$ LANGUAGE plpgsql;
