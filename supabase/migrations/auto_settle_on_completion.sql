-- 운영자의 수동 "지급 완료 처리" 단계를 없앤다.
-- 희망자 양쪽이 애프터의사를 제출해 매칭이 최종 완료되는 순간, 정산 레코드를 바로 'paid'로 생성한다.

CREATE OR REPLACE FUNCTION fn_settle_match(p_match_id UUID)
RETURNS VOID AS $$
DECLARE
  m match_requests%ROWTYPE;
  v_payment payments%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match_requests WHERE id = p_match_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '매칭을 찾을 수 없습니다: %', p_match_id;
  END IF;

  IF m.settlement_completed THEN
    RETURN;
  END IF;

  IF m.after_care_hopeful_1 IS NULL OR m.after_care_hopeful_2 IS NULL THEN
    RAISE EXCEPTION '양측 애프터의사가 모두 제출되어야 정산할 수 있습니다';
  END IF;

  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_1_id AND connector_id = m.connector_1_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '희망자(%)의 이용권(디파짓)이 없습니다', m.hopeful_1_id;
  END IF;

  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout, status, settled_at)
  VALUES (
    p_match_id, m.hopeful_1_id, m.connector_1_id, v_payment.id,
    v_payment.amount_per_session, ROUND(v_payment.amount_per_session * 0.20), ROUND(v_payment.amount_per_session * 0.80),
    'paid', now()
  );

  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_2_id AND connector_id = m.connector_2_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '희망자(%)의 이용권(디파짓)이 없습니다', m.hopeful_2_id;
  END IF;

  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout, status, settled_at)
  VALUES (
    p_match_id, m.hopeful_2_id, m.connector_2_id, v_payment.id,
    v_payment.amount_per_session, ROUND(v_payment.amount_per_session * 0.20), ROUND(v_payment.amount_per_session * 0.80),
    'paid', now()
  );

  UPDATE match_requests SET settlement_completed = true, settlement_completed_at = now() WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;
