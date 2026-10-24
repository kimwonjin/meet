-- 출시 직전 테스트 데이터 지우기 (test_4444_reset.sql을 대신함: 새로 생긴 표까지 모두)
-- 지울 사람: 전화번호가 아래 패턴인 회원·파트너 (기본 010-4444-로 시작)
-- 다른 번호로 테스트했다면 맨 아래 두 곳의 '010-4444-%'를 그 번호로 바꿔 한 번 더 실행한다

-- 1) 먼저 이것만 실행해서 지울 양을 본다 (아무것도 지우지 않음)
WITH t AS (SELECT id FROM users WHERE phone LIKE '010-4444-%'),
     m AS (SELECT id FROM match_requests WHERE hopeful_1_id IN (SELECT id FROM t) OR hopeful_2_id IN (SELECT id FROM t)
             OR connector_1_id IN (SELECT id FROM t) OR connector_2_id IN (SELECT id FROM t))
SELECT
  (SELECT count(*) FROM t) AS 사람,
  (SELECT count(*) FROM users WHERE id IN (SELECT id FROM t) AND role = 'connector') AS 그중_파트너,
  (SELECT count(*) FROM m) AS 매칭,
  (SELECT count(*) FROM payments WHERE hopeful_id IN (SELECT id FROM t) OR connector_id IN (SELECT id FROM t)) AS 이용권,
  (SELECT count(*) FROM settlements WHERE match_request_id IN (SELECT id FROM m) OR hopeful_id IN (SELECT id FROM t) OR connector_id IN (SELECT id FROM t)) AS 정산,
  (SELECT count(*) FROM chat_threads WHERE participant_1_id IN (SELECT id FROM t) OR participant_2_id IN (SELECT id FROM t)) AS 대화방,
  -- 테스트하지 않은 진짜 사람과 엮인 매칭이 있으면 0이 아니다 → 실행하기 전에 알려 주세요
  (SELECT count(*) FROM match_requests WHERE id IN (SELECT id FROM m)
     AND EXISTS (SELECT 1 FROM users u WHERE u.id IN (hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id) AND u.phone NOT LIKE '010-4444-%')) AS 확인_필요_매칭;

-- 2) 확인_필요_매칭이 0이면 아래를 통째로 실행한다 (중간에 오류가 나면 아무것도 지워지지 않는다)
BEGIN;
CREATE TEMP TABLE _t ON COMMIT DROP AS SELECT id FROM users WHERE phone LIKE '010-4444-%';
CREATE TEMP TABLE _m ON COMMIT DROP AS SELECT id FROM match_requests
  WHERE hopeful_1_id IN (SELECT id FROM _t) OR hopeful_2_id IN (SELECT id FROM _t) OR connector_1_id IN (SELECT id FROM _t) OR connector_2_id IN (SELECT id FROM _t);
CREATE TEMP TABLE _th ON COMMIT DROP AS SELECT id FROM chat_threads WHERE participant_1_id IN (SELECT id FROM _t) OR participant_2_id IN (SELECT id FROM _t);

-- 매칭에 딸린 것
DELETE FROM match_reminders WHERE match_id IN (SELECT id FROM _m) OR user_id IN (SELECT id FROM _t);
DELETE FROM connector_reviews WHERE match_request_id IN (SELECT id FROM _m) OR hopeful_id IN (SELECT id FROM _t) OR connector_id IN (SELECT id FROM _t);
DELETE FROM settlements WHERE match_request_id IN (SELECT id FROM _m) OR hopeful_id IN (SELECT id FROM _t) OR connector_id IN (SELECT id FROM _t);
DELETE FROM match_requests WHERE id IN (SELECT id FROM _m);
-- 채팅
DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM _th) OR sender_id IN (SELECT id FROM _t);
DELETE FROM chat_threads WHERE id IN (SELECT id FROM _th);
-- 돈 (이용권·충전·환불·출금·계좌)
DELETE FROM refund_requests WHERE hopeful_id IN (SELECT id FROM _t);
DELETE FROM withdrawal_requests WHERE connector_id IN (SELECT id FROM _t);
DELETE FROM connector_bank_accounts WHERE connector_id IN (SELECT id FROM _t);
DELETE FROM payments WHERE hopeful_id IN (SELECT id FROM _t) OR connector_id IN (SELECT id FROM _t);
DELETE FROM wallet_charges WHERE hopeful_id IN (SELECT id FROM _t);
-- 가입·동맹·초대
DELETE FROM hopeful_requests WHERE hopeful_id IN (SELECT id FROM _t) OR connector_id IN (SELECT id FROM _t);
DELETE FROM connector_alliances WHERE connector_1_id IN (SELECT id FROM _t) OR connector_2_id IN (SELECT id FROM _t);
DELETE FROM invite_events WHERE connector_id IN (SELECT id FROM _t) OR user_id IN (SELECT id FROM _t);
DELETE FROM invite_links WHERE connector_id IN (SELECT id FROM _t);
DELETE FROM connector_pool_stats WHERE connector_id IN (SELECT id FROM _t);
-- 사람에 딸린 것
DELETE FROM notifications WHERE user_id IN (SELECT id FROM _t);
DELETE FROM member_notes WHERE connector_id IN (SELECT id FROM _t) OR hopeful_id IN (SELECT id FROM _t);
DELETE FROM feedback WHERE user_id IN (SELECT id FROM _t);
DELETE FROM avoid_contacts WHERE user_id IN (SELECT id FROM _t);
DELETE FROM user_consents WHERE user_id IN (SELECT id FROM _t);
DELETE FROM user_reports WHERE reporter_id IN (SELECT id FROM _t) OR target_id IN (SELECT id FROM _t);
DELETE FROM user_blocks WHERE blocker_id IN (SELECT id FROM _t) OR blocked_id IN (SELECT id FROM _t);
DELETE FROM push_subscriptions WHERE user_id IN (SELECT id FROM _t);
DELETE FROM connectors WHERE id IN (SELECT id FROM _t);
DELETE FROM users WHERE id IN (SELECT id FROM _t);
COMMIT;

-- 3) 다시 1)을 실행해 모두 0인지 확인한다
-- 사진 파일은 Supabase › Storage › profile-photos 에서 테스트 사람 폴더(사람 id)를 지운다
