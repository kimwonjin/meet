-- 파트너가 회원에 대해 남기는 것
-- 1) 메모: 그 파트너만 보는 기록 (회원마다 한 줄)
-- 2) 직접 만나 확인: 파트너가 회원을 직접 만나 신분을 확인한 시각 (내 회원 관계에 남긴다)
-- 실행 전에는 앱이 메모·확인 표시만 보여주지 않고 나머지는 그대로 동작한다

CREATE TABLE IF NOT EXISTS member_notes (
  connector_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hopeful_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, hopeful_id)
);
ALTER TABLE member_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_notes_all ON member_notes;
CREATE POLICY member_notes_all ON member_notes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE hopeful_requests ADD COLUMN IF NOT EXISTS identity_checked_at TIMESTAMPTZ;
