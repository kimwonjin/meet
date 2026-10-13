-- 010-4444 테스트 데이터 전부 지우기
-- 1) 먼저 아래 SELECT로 지울 양을 확인한다
SELECT
  (SELECT count(*) FROM users WHERE phone LIKE '010-4444-%') AS 사용자,
  (SELECT count(*) FROM payments p JOIN users u ON u.id = p.hopeful_id WHERE u.phone LIKE '010-4444-%') AS 이용권,
  (SELECT count(*) FROM hopeful_requests r JOIN users u ON u.id = r.hopeful_id WHERE u.phone LIKE '010-4444-%') AS 가입,
  (SELECT count(*) FROM match_requests m JOIN users u ON u.id IN (m.hopeful_1_id, m.hopeful_2_id) WHERE u.phone LIKE '010-4444-%') AS 매칭;

-- 2) 매칭이 0이면 아래를 실행한다 (매칭이 있으면 알려주세요)
BEGIN;
DELETE FROM payments WHERE hopeful_id IN (SELECT id FROM users WHERE phone LIKE '010-4444-%');
DELETE FROM hopeful_requests WHERE hopeful_id IN (SELECT id FROM users WHERE phone LIKE '010-4444-%')
                                OR connector_id IN (SELECT id FROM users WHERE phone LIKE '010-4444-%');
DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '010-4444-%');
DELETE FROM connectors WHERE id IN (SELECT id FROM users WHERE phone LIKE '010-4444-%');
DELETE FROM users WHERE phone LIKE '010-4444-%';
COMMIT;
