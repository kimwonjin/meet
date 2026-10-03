-- 지갑(캐시) 방식으로 결제 시스템 재설계
--
-- 기존: 희망자가 연결자별로 이용권(N회) 패키지를 구매 (payments에 connector_id, session_count 등)
-- 변경: 희망자가 연결자 구분 없이 일반 캐시를 충전하고, 매칭이 정산될 때 그 매칭 연결자의
-- 회당 비용(fee_per_session)만큼 지갑에서 차감한다 (아프리카TV 별풍선과 유사한 선불 캐시 모델).
--
-- 지갑 잔액은 별도 컬럼으로 저장하지 않고 항상 계산한다 (동기화 버그 방지):
--   잔액 = 충전 합계(payments) - 정산으로 나간 합계(내가 hopeful로 등장하는 settlements의 amount_per_session 합)
--
-- 테스트 결제/정산 데이터는 리셋됨 (개발 단계, 사용자 승인 하에 진행).

DROP TABLE IF EXISTS settlements CASCADE;
DROP TABLE IF EXISTS payments CASCADE;

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'failed', 'cancelled')),
  pg_provider TEXT NOT NULL DEFAULT 'mock' CHECK (pg_provider IN ('mock', 'portone')),
  pg_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX payments_hopeful_idx ON payments(hopeful_id);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_allow_all ON payments FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  hopeful_id UUID NOT NULL REFERENCES users(id),
  connector_id UUID NOT NULL REFERENCES users(id),
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
CREATE INDEX settlements_hopeful_idx ON settlements(hopeful_id);
CREATE INDEX settlements_status_idx ON settlements(status);
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlements_allow_all ON settlements FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_get_wallet_balance(p_hopeful_id UUID)
RETURNS NUMERIC AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM payments WHERE hopeful_id = p_hopeful_id AND status = 'paid'), 0)
    - COALESCE((SELECT SUM(amount_per_session) FROM settlements WHERE hopeful_id = p_hopeful_id), 0);
$$ LANGUAGE sql STABLE;

-- 매칭 1건 정산: 양쪽 희망자의 지갑에서 각자 연결자의 회당 비용만큼 차감(계산상)하고
-- 80/20으로 정산 레코드를 생성한다. 이미 정산된 매칭은 그대로 반환(멱등).
CREATE OR REPLACE FUNCTION fn_settle_match(p_match_id UUID)
RETURNS VOID AS $$
DECLARE
  m match_requests%ROWTYPE;
  v_fee_1 NUMERIC;
  v_fee_2 NUMERIC;
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

  SELECT fee_per_session INTO v_fee_1 FROM connectors WHERE id = m.connector_1_id;
  SELECT fee_per_session INTO v_fee_2 FROM connectors WHERE id = m.connector_2_id;

  IF fn_get_wallet_balance(m.hopeful_1_id) < v_fee_1 THEN
    RAISE EXCEPTION '희망자(%)의 지갑 잔액이 부족합니다', m.hopeful_1_id;
  END IF;
  IF fn_get_wallet_balance(m.hopeful_2_id) < v_fee_2 THEN
    RAISE EXCEPTION '희망자(%)의 지갑 잔액이 부족합니다', m.hopeful_2_id;
  END IF;

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, amount_per_session, platform_fee, connector_payout)
  VALUES (p_match_id, m.hopeful_1_id, m.connector_1_id, v_fee_1, ROUND(v_fee_1 * 0.20), ROUND(v_fee_1 * 0.80));

  INSERT INTO settlements (match_request_id, hopeful_id, connector_id, amount_per_session, platform_fee, connector_payout)
  VALUES (p_match_id, m.hopeful_2_id, m.connector_2_id, v_fee_2, ROUND(v_fee_2 * 0.20), ROUND(v_fee_2 * 0.80));

  UPDATE match_requests SET settlement_completed = true, settlement_completed_at = now() WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql;
