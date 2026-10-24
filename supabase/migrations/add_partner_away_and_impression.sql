-- 파트너 '자리 비움' + 만남 후 한 줄 소감
-- 1) connectors.away_until: 이 날(한국 날짜)까지 자리 비움. 회원 채팅에 안내가 뜨고, 주간 독려 알림을 쉰다
-- 2) match_requests.impression_1/2: 회원이 애프터를 고를 때 남기는 한 줄 소감 (담당 파트너만 봄)
-- 실행 전에도 앱은 그대로 동작한다 (자리 비움 메뉴·소감 칸만 숨겨짐)

ALTER TABLE connectors ADD COLUMN IF NOT EXISTS away_until DATE;
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS impression_1 TEXT;
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS impression_2 TEXT;

-- 주간 독려 알림: 자리 비움 중인 파트너는 건너뛴다 (예약 시간은 그대로)
CREATE OR REPLACE FUNCTION fn_nudge_idle_partners() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  sent INTEGER;
BEGIN
  WITH p AS (
    SELECT c.id,
      (SELECT count(*) FROM hopeful_requests hr WHERE hr.connector_id = c.id AND hr.status = 'approved') AS members,
      (SELECT count(DISTINCT pay.hopeful_id) FROM payments pay
         JOIN hopeful_requests hr ON hr.hopeful_id = pay.hopeful_id AND hr.connector_id = c.id AND hr.status = 'approved'
         WHERE pay.connector_id = c.id AND pay.status = 'paid' AND pay.sessions_remaining > 0
           AND NOT EXISTS (
             SELECT 1 FROM match_requests m
             WHERE pay.hopeful_id IN (m.hopeful_1_id, m.hopeful_2_id)
               AND m.status IS DISTINCT FROM 'rejected' AND NOT COALESCE(m.settlement_completed, false))) AS waiting
    FROM connectors c JOIN users u ON u.id = c.id
    WHERE c.status = 'approved' AND u.withdrawn_at IS NULL AND u.suspended_at IS NULL
      AND (c.away_until IS NULL OR c.away_until < (now() AT TIME ZONE 'Asia/Seoul')::date)
      AND NOT EXISTS (
        SELECT 1 FROM match_requests m
        WHERE (m.proposer_connector_id = c.id OR m.connector_1_id = c.id) AND m.created_at > now() - INTERVAL '30 days')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = c.id AND n.type = 'partner_idle_nudge' AND n.created_at > now() - INTERVAL '7 days')
  )
  INSERT INTO notifications (user_id, type, title, body, deep_link_route, deep_link_params)
  SELECT p.id, 'partner_idle_nudge',
    '한 달 넘게 새 소개가 없어요',
    CASE WHEN p.waiting > 0
      THEN '소개를 기다리는 회원이 ' || p.waiting || '명 있어요. 매칭 탭에서 어울리는 두 사람을 골라 보세요'
      ELSE '내 회원 ' || p.members || '명 중 어울리는 두 사람을 골라 소개를 제안해 보세요' END,
    '/matching', jsonb_build_object('view', 'active')
  FROM p WHERE p.members >= 2;

  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END;
$$;

