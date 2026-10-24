-- 만남 안전 알림 (30분마다 확인, 한 사람에게 한 번씩: match_reminders 사용 → add_reminders.sql 먼저)
-- 1) 만남 당일 아침 9시 이후 (만남 1시간 전까지): 안전 수칙
-- 2) 만남 다음 날 오전 10시 이후 (그날 안): "만남은 괜찮으셨나요?" → 홈에서 '괜찮았어요 / 불편한 일이 있었어요'
-- 취소된 매칭, 탈퇴·정지한 회원에게는 보내지 않는다. 실행 전에는 알림만 없고 앱 안 안내는 그대로 보인다

CREATE OR REPLACE FUNCTION fn_send_safety_notices() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  sent INTEGER;
  v_now TIMESTAMP := now() AT TIME ZONE 'Asia/Seoul';
BEGIN
  WITH m AS (
    SELECT r.id, r.hopeful_1_id, r.hopeful_2_id, r.meeting_scheduled_at,
      (r.meeting_scheduled_at AT TIME ZONE 'Asia/Seoul') AS kst
    FROM match_requests r
    WHERE r.meeting_scheduled_at IS NOT NULL
      AND COALESCE(r.hopeful_1_approved, false) AND COALESCE(r.hopeful_2_approved, false)
      AND r.status IS DISTINCT FROM 'rejected'  -- 취소·기한 종료·노쇼는 rejected
      AND r.meeting_scheduled_at > now() - INTERVAL '2 days'
  ),
  cand AS (
    SELECT m.id AS match_id, 'safety_today' AS kind, h.uid AS user_id,
      '오늘 만남, 안전하게 즐기세요' AS title,
      '처음엔 사람이 많은 곳에서 만나고, 만나는 곳을 가까운 사람에게 알려 두세요. 불편하면 앱에서 바로 신고할 수 있어요' AS body,
      NULL::jsonb AS params
    FROM m CROSS JOIN LATERAL (VALUES (m.hopeful_1_id), (m.hopeful_2_id)) AS h(uid)
    WHERE m.kst::date = v_now::date AND v_now::time >= TIME '09:00'
      AND m.meeting_scheduled_at > now() + INTERVAL '1 hour'
    UNION ALL
    SELECT m.id, 'safety_check', h.uid,
      '어제 만남은 괜찮으셨나요?',
      '불편한 일이 있었다면 알려 주세요. 알려 준 사실은 상대에게 알리지 않아요',
      jsonb_build_object('safety', m.id)
    FROM m CROSS JOIN LATERAL (VALUES (m.hopeful_1_id), (m.hopeful_2_id)) AS h(uid)
    WHERE m.kst::date = v_now::date - 1 AND v_now::time >= TIME '10:00'
  ),
  ok AS (
    SELECT DISTINCT ON (cand.match_id, cand.kind, cand.user_id) cand.*
    FROM cand JOIN users u ON u.id = cand.user_id
    WHERE u.withdrawn_at IS NULL AND u.suspended_at IS NULL
  ),
  ins AS (
    INSERT INTO match_reminders (match_id, kind, user_id)
    SELECT match_id, kind, user_id FROM ok
    ON CONFLICT DO NOTHING
    RETURNING match_id, kind, user_id
  )
  INSERT INTO notifications (user_id, type, title, body, deep_link_route, deep_link_params)
  SELECT ok.user_id, 'reminder_' || ok.kind, ok.title, ok.body, '/home', ok.params
  FROM ok JOIN ins USING (match_id, kind, user_id);

  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dudu-safety';
SELECT cron.schedule('dudu-safety', '*/30 * * * *', 'SELECT fn_send_safety_notices();');
