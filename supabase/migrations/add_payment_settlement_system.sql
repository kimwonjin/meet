-- 결제/정산 시스템
-- 결제: 희망자가 연결자별로 이용권(N회) 패키지를 구매 (PortOne 연동 전까지는 mock 검증)
-- 정산: 매칭이 양측 애프터의사 제출로 완료되는 시점에 회당 금액을 80(연결자)/20(플랫폼)로 분배
--
-- 기존 payments/settlements 테이블은 "매칭 1건 = 연결자 1명에게 금액 1건" 구조로,
-- 이번 스펙(희망자-연결자별 이용권 패키지, 매칭 1건당 양쪽 각각 1회 차감)과 단위가 달라 재설계함.
-- 앱 코드에서 두 테이블 모두 참조되지 않는 것을 확인 후 진행.

DROP TABLE IF EXISTS settlements CASCADE;
DROP TABLE IF EXISTS payments CASCADE;

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id),
  connector_id UUID NOT NULL REFERENCES users(id),
  session_count INT NOT NULL CHECK (session_count > 0),
  amount_total NUMERIC NOT NULL CHECK (amount_total >= 0),
  amount_per_session NUMERIC NOT NULL,
  sessions_remaining INT NOT NULL CHECK (sessions_remaining >= 0),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'failed', 'cancelled')),
  pg_provider TEXT NOT NULL DEFAULT 'mock' CHECK (pg_provider IN ('mock', 'portone')),
  pg_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX payments_hopeful_connector_idx ON payments(hopeful_id, connector_id);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  hopeful_id UUID NOT NULL REFERENCES users(id),
  connector_id UUID NOT NULL REFERENCES users(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  amount_per_session NUMERIC NOT NULL,
  platform_fee NUMERIC NOT NULL,
  connector_payout NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  settled_at TIMESTAMPTZ,
  paid_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (match_request_id, hopeful_id)
);

CREATE INDEX settlements_connector_idx ON settlements(connector_id);
CREATE INDEX settlements_status_idx ON settlements(status);

-- 매칭 1건 정산: 양쪽 희망자의 이용권을 각자 연결자 계좌에서 1회 차감하고,
-- 회당 금액의 80/20으로 정산 레코드를 생성한다. 이미 정산된 매칭은 그대로 반환(멱등).
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
    RETURN; -- 이미 정산됨
  END IF;

  IF m.after_care_hopeful_1 IS NULL OR m.after_care_hopeful_2 IS NULL THEN
    RAISE EXCEPTION '양측 애프터의사가 모두 제출되어야 정산할 수 있습니다';
  END IF;

  -- 희망자1 측 정산
  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_1_id AND connector_id = m.connector_1_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '희망자(%)의 잔여 이용권이 없습니다', m.hopeful_1_id;
  END IF;

  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout)
  VALUES (
    p_match_id, m.hopeful_1_id, m.connector_1_id, v_payment.id,
    v_payment.amount_per_session,
    ROUND(v_payment.amount_per_session * 0.20),
    ROUND(v_payment.amount_per_session * 0.80)
  );

  -- 희망자2 측 정산
  SELECT * INTO v_payment FROM payments
    WHERE hopeful_id = m.hopeful_2_id AND connector_id = m.connector_2_id
      AND status = 'paid' AND sessions_remaining > 0
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '희망자(%)의 잔여 이용권이 없습니다', m.hopeful_2_id;
  END IF;

  UPDATE payments SET sessions_remaining = sessions_remaining - 1 WHERE id = v_payment.id;

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, payment_id, amount_per_session, platform_fee, connector_payout)
  VALUES (
    p_match_id, m.hopeful_2_id, m.connector_2_id, v_payment.id,
    v_payment.amount_per_session,
    ROUND(v_payment.amount_per_session * 0.20),
    ROUND(v_payment.amount_per_session * 0.80)
  );

  UPDATE match_requests SET settlement_completed = true, settlement_completed_at = now() WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;

-- 운영자 role 추가 (수동 정산 처리 화면용)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('hopeful', 'connector', 'operator'));

-- 운영자 계정 만들기 예시 (전화번호/이름 채워서 직접 실행):
-- INSERT INTO users (phone, name, birth_date, gender, role) VALUES ('01000000000', '운영자', '1990-01-01', 'M', 'operator');
