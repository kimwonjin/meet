-- '다음엔 이런 분이면 좋겠어요': 회원이 거절·애프터 때 남기는 한 줄 (가장 최근 것만, 담당 파트너만 봄)
-- 실행 전에도 앱은 그대로 동작한다 (입력 칸만 숨겨짐)
ALTER TABLE users ADD COLUMN IF NOT EXISTS next_wish TEXT;
