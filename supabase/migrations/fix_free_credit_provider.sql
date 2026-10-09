-- 무료 이용권 저장 오류 수정: 결제 기록의 결제 방식(pg_provider) 허용 목록에 'free_gift' 추가
-- (처음 표를 만들 때 'mock', 'portone'만 허용해서 무료 이용권 저장이 거절됐다)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_pg_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_pg_provider_check CHECK (pg_provider IN ('mock', 'portone', 'free_gift'));
