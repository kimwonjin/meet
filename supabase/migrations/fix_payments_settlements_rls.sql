-- payments/settlements 테이블에 RLS가 걸려 있어 anon 키로 insert가 막히는 문제 수정
-- 이 앱은 Supabase Auth 세션 없이 anon 키로만 동작하므로, 다른 테이블(match_requests 등)과
-- 동일하게 전체 허용 정책을 추가한다.

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_allow_all ON payments;
CREATE POLICY payments_allow_all ON payments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlements_allow_all ON settlements;
CREATE POLICY settlements_allow_all ON settlements FOR ALL USING (true) WITH CHECK (true);
