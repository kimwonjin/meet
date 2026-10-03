-- 1) 노쇼 신고가 있으면 정산하지 않는다 (두 회원 이용권 차감 없음, 두 파트너 정산 없음).
--    한쪽이 노쇼를 신고하면 상대 응답을 기다리지 않고 바로 종료한다.
-- 2) 애프터 무응답 자동 마무리를 위해 만남 완료 시각을 기록한다 (앱에서 7일 경과 시 '미신청' 처리 후 정산).

ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS meeting_completed_at TIMESTAMPTZ;
-- 정산 없이 종료된 이유 (예: 'no_show'). NULL이면 정상 정산.
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS closed_reason TEXT;

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

  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (m.connector_1_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');

  IF m.connector_2_id != m.connector_1_id THEN
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (m.connector_2_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');
  END IF;
END;
$$ LANGUAGE plpgsql;
