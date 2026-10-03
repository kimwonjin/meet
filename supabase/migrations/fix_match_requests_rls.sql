-- match_requests 테이블은 대시보드에서 직접 만들어져 이 저장소의 마이그레이션으로 추적되지 않고 있었다.
-- 기존 정책은 SELECT/INSERT/UPDATE만 허용하고 DELETE가 빠져 있어(개발 단계 permissive 패턴과 불일치),
-- 다른 permissive 테이블들과 동일하게 FOR ALL로 통일해 앞으로 스키마 변경 이력에 포함시킨다.
ALTER TABLE match_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_requests_allow_all ON match_requests;
CREATE POLICY match_requests_allow_all ON match_requests FOR ALL USING (true) WITH CHECK (true);
