-- 환불 요청 + 회원 탈퇴
-- 환불 대상: 지갑 잔액 + 사용하지 않은 이용권 (진행 중인 매칭에 필요한 이용권은 제외)
-- 탈퇴: 진행 중인 매칭이 없을 때만 가능. 결제·정산 기록은 법정 보관을 위해 남기고 개인정보는 지운다.

ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_sessions INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  wallet_amount NUMERIC NOT NULL DEFAULT 0,   -- 처리 시 확정된 지갑 환불액
  credit_amount NUMERIC NOT NULL DEFAULT 0,   -- 처리 시 확정된 이용권 환불액
  reject_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS refund_requests_hopeful_idx ON refund_requests(hopeful_id, status);
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_requests_all ON refund_requests;
CREATE POLICY refund_requests_all ON refund_requests FOR ALL USING (true) WITH CHECK (true);

-- 지갑 잔액 = 충전 합계 - 이용권 구매 합계 - 환불된 지갑 금액
CREATE OR REPLACE FUNCTION fn_get_wallet_balance(p_hopeful_id UUID)
RETURNS NUMERIC AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM wallet_charges WHERE hopeful_id = p_hopeful_id AND status = 'paid'), 0)
    - COALESCE((SELECT SUM(amount_total) FROM payments WHERE hopeful_id = p_hopeful_id AND status = 'paid'), 0)
    - COALESCE((SELECT SUM(wallet_amount) FROM refund_requests WHERE hopeful_id = p_hopeful_id AND status = 'completed'), 0);
$$ LANGUAGE sql STABLE;

-- 파트너별로 진행 중인 매칭에 묶인 이용권 수
CREATE OR REPLACE FUNCTION fn_reserved_sessions(p_hopeful_id UUID, p_connector_id UUID)
RETURNS INT AS $$
  SELECT count(*)::INT FROM match_requests
  WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
    AND ((hopeful_1_id = p_hopeful_id AND connector_1_id = p_connector_id)
      OR (hopeful_2_id = p_hopeful_id AND connector_2_id = p_connector_id));
$$ LANGUAGE sql STABLE;

-- 지금 환불받을 수 있는 금액 (fn_process_refund와 같은 방식으로 계산)
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
    v_sessions := v_sessions + (p.sessions_remaining - v_keep);
    v_credit := v_credit + (p.sessions_remaining - v_keep) * p.amount_per_session;
  END LOOP;

  RETURN json_build_object('wallet', v_wallet, 'credit', v_credit, 'sessions', v_sessions, 'total', v_wallet + v_credit);
END;
$$ LANGUAGE plpgsql STABLE;

-- 운영자 환불 처리: 그 시점의 환불 가능 금액을 확정하고, 이용권을 차감한다 (입금은 운영자가 직접)
CREATE OR REPLACE FUNCTION fn_process_refund(p_request_id UUID)
RETURNS JSON AS $$
DECLARE
  req refund_requests%ROWTYPE;
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
    RAISE EXCEPTION '처리할 수 없는 환불 요청입니다';
  END IF;

  v_wallet := GREATEST(0, fn_get_wallet_balance(req.hopeful_id));

  -- 파트너별로 진행 중 매칭 몫은 오래된 결제부터 남겨두고 나머지를 환불
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

  RETURN json_build_object('wallet', v_wallet, 'credit', v_credit, 'total', v_wallet + v_credit);
END;
$$ LANGUAGE plpgsql;

-- 회원 탈퇴
CREATE OR REPLACE FUNCTION fn_withdraw_user(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_refundable JSON;
  v_earned NUMERIC;
  v_withdrawn NUMERIC;
BEGIN
  -- 진행 중인 매칭 (회원 또는 파트너로 참여)
  IF EXISTS (
    SELECT 1 FROM match_requests
    WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
      AND p_user_id IN (hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id)
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  -- 환불받을 돈이 남았는데 환불 요청을 하지 않은 경우
  v_refundable := fn_get_refundable(p_user_id);
  IF (v_refundable->>'total')::NUMERIC > 0
     AND NOT EXISTS (SELECT 1 FROM refund_requests WHERE hopeful_id = p_user_id AND status = 'pending') THEN
    RETURN json_build_object('ok', false, 'reason', 'refund_needed', 'amount', (v_refundable->>'total')::NUMERIC);
  END IF;

  -- 파트너 정산금이 남은 경우
  SELECT COALESCE(SUM(connector_payout), 0) INTO v_earned FROM settlements WHERE connector_id = p_user_id AND status = 'paid';
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn FROM withdrawal_requests WHERE connector_id = p_user_id;
  IF v_earned - v_withdrawn > 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'payout_left', 'amount', v_earned - v_withdrawn);
  END IF;

  -- 개인정보 삭제 (결제·정산 기록은 보관)
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
