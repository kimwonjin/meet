-- 쉬는 파트너 깨우기 (매주 월요일 오전 10시, 한국 시간)
-- 승인된 회원이 2명 이상인데 30일 넘게 매칭 제안을 하지 않은 파트너에게 알림 한 번
-- 기다리는 회원(이용권이 남아 있고 진행 중 소개가 없는 내 회원) 수를 함께 알려 준다
-- 같은 파트너에게는 7일에 한 번만. 탈퇴·정지한 파트너에게는 보내지 않는다
-- 실행 전에도 앱은 그대로 동작한다 (파트너 홈 '기다리는 회원'은 앱에서 바로 보임)

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

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dudu-idle-partners';
-- 매주 월요일 01:00 UTC = 한국 시간 오전 10시
SELECT cron.schedule('dudu-idle-partners', '0 1 * * 1', 'SELECT fn_nudge_idle_partners();');
