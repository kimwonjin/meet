-- 탈퇴한 번호의 흔적 (번호 그대로가 아니라 되돌릴 수 없는 해시만 저장)
-- 같은 번호로 다시 가입하면 예전 계정의 차단을 새 계정에 이어 붙이고, 신고 이력이 있으면 운영자에게 알린다
-- 실행 전에는 앱이 이 기능만 건너뛰고 나머지는 그대로 동작한다
CREATE TABLE IF NOT EXISTS withdrawn_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawn_identities_hash_idx ON withdrawn_identities(phone_hash);
ALTER TABLE withdrawn_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withdrawn_identities_all ON withdrawn_identities;
CREATE POLICY withdrawn_identities_all ON withdrawn_identities FOR ALL USING (true) WITH CHECK (true);
