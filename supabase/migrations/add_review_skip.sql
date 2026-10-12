-- 회원이 홈에서 '파트너 후기'를 건너뛴 기록 (다른 기기에서도 다시 묻지 않도록)
-- 후기는 선택이라 건너뛰어도 지난 소개 카드에서 언제든 남길 수 있다.
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS review_skipped_1 BOOLEAN DEFAULT false;
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS review_skipped_2 BOOLEAN DEFAULT false;
