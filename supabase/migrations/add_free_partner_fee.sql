-- 무료로 소개하는 파트너: 1회 비용 0원 = 무료, 비어 있음(NULL) = 아직 안 정함
-- 1) 지금까지는 1,000원 이상만 저장할 수 있었으므로 0원은 '안 정함'이다 → NULL로 바꾸고 기본값을 없앤다
ALTER TABLE connectors ALTER COLUMN fee_per_session DROP DEFAULT;
UPDATE connectors SET fee_per_session = NULL WHERE fee_per_session = 0;

-- 2) 0원 이용권도 받을 수 있게 (비용 미정은 그대로 거절)
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
  IF v_fee IS NULL OR v_fee < 0 THEN
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
  VALUES (p_hopeful_id, p_connector_id, p_session_count, v_total, v_fee, p_session_count, 'paid', CASE WHEN v_fee = 0 THEN 'free_partner' ELSE 'mock' END, now())
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'total', v_total);
END;
$$ LANGUAGE plpgsql;
