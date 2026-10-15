-- 탈퇴 정리 보강 + 가입 신청 중복 방지
-- 실행 전에도 앱은 화면에서 같은 처리를 하므로 그대로 동작한다

-- 1) 같은 회원이 같은 파트너에게 '대기 중' 신청을 두 번 넣지 못하게 (두 화면에서 동시에 누른 경우)
--    이미 중복이 있으면 가장 오래된 것만 남기고 지운다 (먼저 아래 SELECT로 확인)
-- SELECT hopeful_id, connector_id, count(*) FROM hopeful_requests WHERE status = 'pending' GROUP BY 1, 2 HAVING count(*) > 1;
DELETE FROM hopeful_requests r
USING hopeful_requests o
WHERE r.status = 'pending' AND o.status = 'pending'
  AND r.hopeful_id = o.hopeful_id AND r.connector_id = o.connector_id
  AND r.created_at > o.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS hopeful_requests_one_pending
  ON hopeful_requests (hopeful_id, connector_id) WHERE status = 'pending';

-- 2) 탈퇴한 사람의 파트너 신청·활동 상태와 초대 링크를 닫는다
UPDATE connectors c SET status = 'rejected'
FROM users u
WHERE u.id = c.id AND u.withdrawn_at IS NOT NULL AND c.status IN ('pending', 'approved');
UPDATE invite_links l SET is_active = false
FROM users u
WHERE u.id = l.connector_id AND u.withdrawn_at IS NOT NULL AND l.is_active;
