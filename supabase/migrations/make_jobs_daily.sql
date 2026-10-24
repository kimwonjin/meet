-- 예약 작업을 30분마다 → 매일 한 번 (한국 시간 오전 9시)으로
-- 하루 한 번만 돌아도 빠지는 알림이 없도록 만남 알림·안부 알림의 시간 조건을 함께 고친다

CREATE OR REPLACE FUNCTION fn_send_reminders() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  sent INTEGER;
BEGIN
  WITH m AS (
    SELECT r.*,
      (r.connector_1_id = r.connector_2_id OR (COALESCE(r.connector_1_consented, false) AND COALESCE(r.connector_2_consented, false))) AS consent_done,
      COALESCE(r.hopeful_1_approved, false) AND COALESCE(r.hopeful_2_approved, false) AS members_done
    FROM match_requests r
    WHERE r.status IS DISTINCT FROM 'rejected' AND NOT COALESCE(r.settlement_completed, false)
  ),
  d AS (
    SELECT m.*,
      (CASE WHEN m.consent_done AND m.consented_at IS NOT NULL AND m.consented_at > m.created_at THEN m.consented_at ELSE m.created_at END) + INTERVAL '7 days' AS proposal_due,
      COALESCE(m.meeting_completed_at, m.meeting_scheduled_at) + INTERVAL '7 days' AS after_due
    FROM m
  ),
  cand AS (
    -- 1) 동맹 매칭 동의 기한
    SELECT d.id AS match_id, 'consent_due' AS kind, c.uid AS user_id,
      '동맹 매칭 동의 기한이 얼마 남지 않았어요' AS title,
      fn_kst_label(d.proposal_due) || '까지 동의하지 않으면 자동으로 종료돼요' AS body,
      '/matching' AS route
    FROM d CROSS JOIN LATERAL (VALUES
      (CASE WHEN NOT COALESCE(d.connector_1_consented, false) THEN d.connector_1_id END),
      (CASE WHEN NOT COALESCE(d.connector_2_consented, false) THEN d.connector_2_id END)) AS c(uid)
    WHERE NOT d.consent_done AND c.uid IS NOT NULL
      AND d.proposal_due > now() AND d.proposal_due <= now() + INTERVAL '24 hours'
    UNION ALL
    -- 2) 회원 답변 기한
    SELECT d.id, 'answer_due', h.uid,
      '소개 제안에 답해 주세요',
      fn_kst_label(d.proposal_due) || '까지 답하지 않으면 이번 소개는 자동으로 종료돼요',
      '/home'
    FROM d CROSS JOIN LATERAL (VALUES
      (CASE WHEN NOT COALESCE(d.hopeful_1_approved, false) THEN d.hopeful_1_id END),
      (CASE WHEN NOT COALESCE(d.hopeful_2_approved, false) THEN d.hopeful_2_id END)) AS h(uid)
    WHERE d.consent_done AND NOT d.members_done AND h.uid IS NOT NULL
      AND d.proposal_due > now() AND d.proposal_due <= now() + INTERVAL '24 hours'
    UNION ALL
    -- 3) 다가오는 만남
    SELECT d.id, 'meeting_soon', h.uid,
      CASE WHEN (d.meeting_scheduled_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date THEN '오늘 만남이 있어요' ELSE '내일 만남이 있어요' END,
      fn_kst_label(d.meeting_scheduled_at) || '에 만나요. 시간과 장소를 한 번 더 확인해 주세요',
      '/home'
    FROM d CROSS JOIN LATERAL (VALUES (d.hopeful_1_id), (d.hopeful_2_id)) AS h(uid)
    WHERE d.members_done AND d.meeting_scheduled_at IS NOT NULL
      AND d.meeting_status IS DISTINCT FROM 'completed'
      AND d.meeting_scheduled_at > now() AND d.meeting_scheduled_at <= now() + INTERVAL '24 hours'
    UNION ALL
    -- 4) 애프터 기한
    SELECT d.id, 'after_due', h.uid,
      '만남은 어떠셨어요?',
      fn_kst_label(d.after_due) || '까지 다음 만남 의사를 알려 주세요. 답이 없으면 이번 만남으로 마무리돼요',
      '/home'
    FROM d CROSS JOIN LATERAL (VALUES
      (CASE WHEN d.after_care_hopeful_1 IS NULL THEN d.hopeful_1_id END),
      (CASE WHEN d.after_care_hopeful_2 IS NULL THEN d.hopeful_2_id END)) AS h(uid)
    WHERE d.meeting_status = 'completed' AND h.uid IS NOT NULL AND d.after_due IS NOT NULL
      AND d.after_due > now() AND d.after_due <= now() + INTERVAL '24 hours'
  ),
  ok AS (
    -- 탈퇴·정지한 사람에게는 보내지 않는다
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
  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  SELECT ok.user_id, 'reminder_' || ok.kind, ok.title, ok.body, ok.route
  FROM ok JOIN ins USING (match_id, kind, user_id);

  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END;
$$;

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
    WHERE m.kst::date = v_now::date AND v_now::time >= TIME '08:00'
      AND m.meeting_scheduled_at > now() + INTERVAL '1 hour'
    UNION ALL
    SELECT m.id, 'safety_check', h.uid,
      '어제 만남은 괜찮으셨나요?',
      '불편한 일이 있었다면 알려 주세요. 알려 준 사실은 상대에게 알리지 않아요',
      jsonb_build_object('safety', m.id)
    FROM m CROSS JOIN LATERAL (VALUES (m.hopeful_1_id), (m.hopeful_2_id)) AS h(uid)
    WHERE m.kst::date = v_now::date - 1 AND v_now::time >= TIME '08:00'
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

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('dudu-reminders', 'dudu-safety', 'dudu-report-deadline');
SELECT cron.schedule('dudu-reminders', '0 0 * * *', 'SELECT fn_send_reminders();');
SELECT cron.schedule('dudu-safety', '0 0 * * *', 'SELECT fn_send_safety_notices();');
SELECT cron.schedule('dudu-report-deadline', '0 0 * * *', 'SELECT fn_alert_report_deadline();');
