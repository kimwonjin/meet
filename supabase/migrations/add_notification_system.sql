-- ============================================================
-- 알림 시스템: 알림센터(notifications 테이블) + 즉시 트리거 이벤트
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  deep_link_route TEXT,
  deep_link_params JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_allow_all ON notifications;
CREATE POLICY notifications_allow_all ON notifications FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_get_unread_notification_count(p_user_id UUID)
RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM notifications WHERE user_id = p_user_id AND read_at IS NULL;
  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql;

-- 정산 완료 시 연결자에게 알림을 남기도록 fn_settle_match를 갱신한다.
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

  -- 정산 완료 알림 (연결자 1명 또는 서로 다른 두 연결자)
  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  VALUES (m.connector_1_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');

  IF m.connector_2_id != m.connector_1_id THEN
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (m.connector_2_id, 'settlement_completed', '정산이 완료되었습니다', '매칭 건의 정산이 완료되었습니다', '/profile');
  END IF;
END;
$$ LANGUAGE plpgsql;
