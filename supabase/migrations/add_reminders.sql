-- 기한·만남 자동 알림 (30분마다 서버가 확인해서 보낸다)
-- 1) 동맹 매칭 동의 기한이 24시간 안으로 다가오면 → 아직 동의하지 않은 파트너에게
-- 2) 소개 제안 답변 기한이 24시간 안으로 다가오면 → 아직 답하지 않은 회원에게
-- 3) 만남이 24시간 안으로 다가오면 (1시간 전까지) → 두 회원에게
-- 4) 애프터(다음 만남 의사) 기한이 24시간 안으로 다가오면 → 아직 고르지 않은 회원에게
-- 같은 알림은 한 사람에게 한 번만 (match_reminders). 알림이 저장되면 휴대폰 알림도 함께 간다 (add_web_push.sql)
-- 기한 계산은 앱과 같다: 제안 7일 (동맹 매칭은 두 파트너 동의 뒤부터 다시 7일), 애프터 7일
-- 실행 전에는 자동 알림만 없고 앱은 그대로 동작한다

CREATE TABLE IF NOT EXISTS match_reminders (
  match_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, kind, user_id)
);
ALTER TABLE match_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_reminders_all ON match_reminders;
CREATE POLICY match_reminders_all ON match_reminders FOR ALL USING (true) WITH CHECK (true);

-- '10월 25일 오후 7:00' (한국 시간)
CREATE OR REPLACE FUNCTION fn_kst_label(t TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT to_char(t AT TIME ZONE 'Asia/Seoul', 'FMMM"월" FMDD"일" ')
    || CASE WHEN extract(hour FROM t AT TIME ZONE 'Asia/Seoul') < 12 THEN '오전 ' ELSE '오후 ' END
    || to_char(t AT TIME ZONE 'Asia/Seoul', 'FMHH12:MI');
$$;

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
      AND d.meeting_scheduled_at > now() + INTERVAL '1 hour' AND d.meeting_scheduled_at <= now() + INTERVAL '24 hours'
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

-- 30분마다 실행 (같은 이름의 예약이 있으면 바꿔 단다)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dudu-reminders';
SELECT cron.schedule('dudu-reminders', '*/30 * * * *', 'SELECT fn_send_reminders();');
