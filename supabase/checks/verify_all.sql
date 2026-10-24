-- 출시 전 한 번에 확인: 그동안 실행한 SQL이 모두 들어갔는지 (아무것도 바꾸지 않음)
-- 결과 맨 위 줄이 '모두 들어갔어요'면 끝. 아니면 '없음'으로 나온 줄을 알려 주세요
WITH want(kind, name) AS (VALUES
  -- 칸 (표.칸)
  ('칸', 'users.photo_urls'), ('칸', 'users.withdrawn_at'), ('칸', 'users.suspended_at'), ('칸', 'users.paused_at'), ('칸', 'users.preferences'),
  ('칸', 'users.company'), ('칸', 'users.job_category'), ('칸', 'users.extra_conditions'), ('칸', 'users.avoid_same_company'), ('칸', 'users.district'),
  ('칸', 'connectors.career'), ('칸', 'connectors.intro'), ('칸', 'connectors.pending_profile'), ('칸', 'connectors.profile_status'), ('칸', 'connectors.away_until'),
  ('칸', 'hopeful_requests.identity_checked_at'), ('칸', 'hopeful_requests.invite_code'),
  ('칸', 'match_requests.available_dates_1'), ('칸', 'match_requests.meeting_done_connector_1'), ('칸', 'match_requests.closed_reason'), ('칸', 'match_requests.consented_at'),
  ('칸', 'match_requests.review_skipped_1'), ('칸', 'match_requests.partner_note'), ('칸', 'match_requests.reject_reason'), ('칸', 'match_requests.couple_at'),
  ('칸', 'match_requests.impression_1'), ('칸', 'match_requests.impression_2'),
  ('칸', 'payments.refunded_sessions'), ('칸', 'notifications.pushed_at'), ('칸', 'chat_messages.pushed_at'), ('칸', 'user_reports.deadline_alerted_at'),
  -- 표
  ('표', 'member_notes'), ('표', 'feedback'), ('표', 'avoid_contacts'), ('표', 'user_consents'), ('표', 'user_reports'), ('표', 'user_blocks'),
  ('표', 'withdrawn_identities'), ('표', 'invite_links'), ('표', 'invite_events'), ('표', 'share_templates'), ('표', 'push_subscriptions'), ('표', 'push_keys'),
  ('표', 'match_reminders'), ('표', 'connector_reviews'), ('표', 'refund_requests'), ('표', 'withdrawal_requests'), ('표', 'wallet_charges'), ('표', 'settlements'),
  -- 서버 함수
  ('함수', 'fn_propose_match'), ('함수', 'fn_purchase_package'), ('함수', 'fn_settle_match'), ('함수', 'fn_withdraw_user'), ('함수', 'fn_report_user'),
  ('함수', 'fn_member_busy'), ('함수', 'fn_avoid_pairs'), ('함수', 'fn_partner_public_stats'), ('함수', 'fn_free_credit_max'), ('함수', 'fn_grant_free_credit'),
  ('함수', 'fn_get_unread_notification_count'), ('함수', 'fn_push_on_notification'), ('함수', 'fn_send_reminders'), ('함수', 'fn_send_safety_notices'),
  ('함수', 'fn_alert_report_deadline'), ('함수', 'fn_nudge_idle_partners'), ('함수', 'fn_clear_withdrawn_extras'), ('함수', 'fn_company_key')
),
have AS (
  SELECT w.kind, w.name,
    CASE w.kind
      WHEN '칸' THEN EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = split_part(w.name, '.', 1) AND c.column_name = split_part(w.name, '.', 2))
      WHEN '표' THEN EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = w.name)
      ELSE EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = w.name)
    END AS ok
  FROM want w
),
extra AS (
  -- 내용까지 확인할 것: 독려 알림이 자리 비움을 건너뛰는지, 자동 알림 예약 4개가 하루 한 번(주 1회)인지
  SELECT '내용' AS kind, '독려 알림이 자리 비움 파트너를 건너뜀' AS name,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_nudge_idle_partners' AND prosrc LIKE '%away_until%') AS ok
  UNION ALL SELECT '예약', 'dudu-reminders 매일 09시', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dudu-reminders' AND schedule = '0 0 * * *')
  UNION ALL SELECT '예약', 'dudu-safety 매일 09시', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dudu-safety' AND schedule = '0 0 * * *')
  UNION ALL SELECT '예약', 'dudu-report-deadline 매일 09시', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dudu-report-deadline' AND schedule = '0 0 * * *')
  UNION ALL SELECT '예약', 'dudu-idle-partners 월요일 10시', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dudu-idle-partners' AND schedule = '0 1 * * 1')
),
allrows AS (SELECT * FROM have UNION ALL SELECT * FROM extra)
SELECT 종류, 이름, 상태 FROM (
  SELECT 0 AS o, '요약' AS 종류,
    CASE WHEN bool_and(ok) THEN '모두 들어갔어요 (' || count(*) || '개)' ELSE count(*) FILTER (WHERE NOT ok) || '개 없음 / 전체 ' || count(*) || '개' END AS 이름,
    '' AS 상태
  FROM allrows
  UNION ALL
  SELECT 1, kind, name, '없음' FROM allrows WHERE NOT ok
) r ORDER BY o, 종류, 이름;
