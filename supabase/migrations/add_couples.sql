-- 커플 성사 기록: 두 회원이 모두 '또 만나고 싶어요'를 고른 매칭을 파트너가 '커플 성사'로 표시한다
-- 파트너 공개 소개·파트너 정보에 '커플 성사 n쌍'으로 보인다 (숫자만, 회원 정보는 보이지 않음)
-- 실행 전에는 표시 버튼과 숫자가 보이지 않고 나머지는 그대로 동작한다

ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS couple_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS match_requests_couple_idx ON match_requests(couple_at) WHERE couple_at IS NOT NULL;
