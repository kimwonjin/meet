-- 만남 완료는 두 연결자가 모두 눌러야 다음 단계(회원 애프터 요청)로 넘어간다.
-- 내부 매칭(연결자 1명)은 한 번 누르면 둘 다 true가 된다.
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS meeting_done_connector_1 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS meeting_done_connector_2 BOOLEAN NOT NULL DEFAULT false;
