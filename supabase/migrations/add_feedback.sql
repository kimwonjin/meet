-- 앱 안 '의견 보내기'
-- 회원·파트너가 보낸 문제·의견. 어느 화면에서 보냈는지, 붙인 사진, 기기 정보를 함께 남긴다
-- 운영자 현황 탭에서 모아 보고 '처리 완료'로 표시한다
-- 실행 전에는 앱이 '의견 보내기' 메뉴만 보여주지 않고 나머지는 그대로 동작한다
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  role TEXT,
  screen TEXT,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  photo_url TEXT,
  user_agent TEXT,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at DESC);
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_all ON feedback;
CREATE POLICY feedback_all ON feedback FOR ALL USING (true) WITH CHECK (true);
