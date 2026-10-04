-- 약관 동의 기록 (분쟁 시 언제 어떤 버전에 동의했는지 증빙)
CREATE TABLE IF NOT EXISTS user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc TEXT NOT NULL,          -- 'age19' | 'service' | 'privacy' | 'partner'
  version TEXT NOT NULL,      -- 동의 당시 약관 버전 (예: '2026-10-04')
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_consents_user_idx ON user_consents(user_id, doc);

-- 보안(RLS)은 추후 일괄 적용 예정
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_consents_all ON user_consents;
CREATE POLICY user_consents_all ON user_consents FOR ALL USING (true) WITH CHECK (true);
