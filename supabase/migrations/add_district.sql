-- 서울·경기는 구·시까지 (지역 칸 location은 '서울'처럼 그대로 두고 따로 저장 → 지역 필터·원하는 상대·통계는 그대로)
-- 실행 전에는 구·시 고르기가 보이지 않고 나머지는 그대로 동작한다
ALTER TABLE users ADD COLUMN IF NOT EXISTS district TEXT;
