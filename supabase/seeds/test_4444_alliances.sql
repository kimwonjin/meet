-- 010-4444 테스트 파트너 10명끼리 모두 동맹 (45쌍, 바로 '동맹 중' 상태)
-- 다시 실행해도 중복으로 생기지 않는다

BEGIN;

-- 이미 요청만 오간 쌍은 수락 처리
UPDATE connector_alliances a SET status = 'ACTIVE', updated_at = now()
FROM users u1, users u2
WHERE a.status = 'PENDING'
  AND u1.id = a.connector_1_id AND u2.id = a.connector_2_id
  AND u1.phone LIKE '010-4444-%00' AND u2.phone LIKE '010-4444-%00';

-- 동맹이 없는 쌍은 새로 맺기
INSERT INTO connector_alliances (connector_1_id, connector_2_id, requested_by, status)
SELECT c1.id, c2.id, c1.id, 'ACTIVE'
FROM users c1
JOIN users c2 ON c2.phone > c1.phone
WHERE c1.role = 'connector' AND c2.role = 'connector'
  AND c1.phone LIKE '010-4444-%00' AND c2.phone LIKE '010-4444-%00'
  AND NOT EXISTS (
    SELECT 1 FROM connector_alliances a
    WHERE a.status IN ('PENDING', 'ACTIVE')
      AND LEAST(a.connector_1_id, a.connector_2_id) = LEAST(c1.id, c2.id)
      AND GREATEST(a.connector_1_id, a.connector_2_id) = GREATEST(c1.id, c2.id)
  );

COMMIT;

-- 확인: 파트너 10줄, 각 동맹 9
SELECT u.phone AS 파트너, count(a.id) AS 동맹
FROM users u
LEFT JOIN connector_alliances a ON a.status = 'ACTIVE' AND u.id IN (a.connector_1_id, a.connector_2_id)
WHERE u.phone LIKE '010-4444-%00' AND u.role = 'connector'
GROUP BY u.phone ORDER BY u.phone;
