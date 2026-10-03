-- 일반 지갑 충전(카드결제 예정, 지금은 mock)을 위한 테이블.
-- 이 지갑 잔액에서 차감해서 연결자별 이용권(payments 테이블의 디파짓)을 구매한다.
-- 즉 흐름: 충전(wallet_charges) -> 이용권 구매(payments, 지갑에서 차감) -> 매칭 정산(settlements, 이용권에서 차감)

CREATE TABLE wallet_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'failed', 'cancelled')),
  pg_provider TEXT NOT NULL DEFAULT 'mock' CHECK (pg_provider IN ('mock', 'portone')),
  pg_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX wallet_charges_hopeful_idx ON wallet_charges(hopeful_id);
ALTER TABLE wallet_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_charges_allow_all ON wallet_charges FOR ALL USING (true) WITH CHECK (true);

-- 지갑 잔액 = 충전 합계 - 이용권 구매(디파짓)로 이미 나간 합계
-- (매칭 정산은 이용권에서 차감되는 것이지 지갑에서 다시 차감되는 게 아니므로 여기 포함 안 함)
CREATE OR REPLACE FUNCTION fn_get_wallet_balance(p_hopeful_id UUID)
RETURNS NUMERIC AS $$
  SELECT
    COALESCE((SELECT SUM(amount) FROM wallet_charges WHERE hopeful_id = p_hopeful_id AND status = 'paid'), 0)
    - COALESCE((SELECT SUM(amount_total) FROM payments WHERE hopeful_id = p_hopeful_id AND status = 'paid'), 0);
$$ LANGUAGE sql STABLE;
