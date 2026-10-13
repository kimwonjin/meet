-- 동맹 매칭: 두 파트너 동의가 끝난 시각. 회원 답변 기한(7일)을 이때부터 센다.
-- 실행 전에는 매칭을 만든 날 기준으로 계산한다 (지금과 같음)
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ;
