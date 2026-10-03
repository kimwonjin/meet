-- 회원이 매칭 승인 시 고른 "만날 수 있는 날짜". 두 회원의 날짜가 겹치면 가장 빠른 날로 일정이 자동으로 잡힌다.
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS available_dates_1 DATE[];
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS available_dates_2 DATE[];
