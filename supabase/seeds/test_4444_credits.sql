-- 테스트 데이터: 010-4444 회원 90명에게 담당 파트너 이용권 10회씩
-- (test_4444.sql 실행 후에 실행. 이미 이용권이 있는 회원은 건너뛴다)

INSERT INTO payments (hopeful_id, connector_id, session_count, amount_total, amount_per_session, sessions_remaining, status, pg_provider, paid_at)
SELECT r.hopeful_id, r.connector_id, 10, c.fee_per_session * 10, c.fee_per_session, 10, 'paid', 'mock', now()
FROM hopeful_requests r
JOIN users h ON h.id = r.hopeful_id
JOIN connectors c ON c.id = r.connector_id
WHERE h.phone LIKE '010-4444-%' AND r.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.hopeful_id = r.hopeful_id AND p.connector_id = r.connector_id);

-- 확인: 90명, 남은 이용권 합계 900
SELECT count(*) AS 회원수, sum(p.sessions_remaining) AS 남은이용권
FROM payments p JOIN users h ON h.id = p.hopeful_id
WHERE h.phone LIKE '010-4444-%' AND p.status = 'paid';
