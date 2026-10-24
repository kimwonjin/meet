-- 신고 24시간 처리 (약관 제12조)
-- 접수 후 20시간이 지나도 처리하지 않은 신고는 운영자에게 한 번 더 알린다 (신고마다 한 번, 매일 오전 9시 확인)
-- 실행 전에도 운영자 화면의 남은 시간 표시·강조는 그대로 동작한다 (알림만 없음)

ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS deadline_alerted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION fn_alert_report_deadline() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_n INT;
BEGIN
  WITH due AS (
    UPDATE user_reports SET deadline_alerted_at = now()
    WHERE status = 'open' AND deadline_alerted_at IS NULL AND created_at < now() - interval '20 hours'
    RETURNING id, reason
  ), sent AS (
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    SELECT u.id, 'report_deadline', '처리 기한이 다가온 신고가 있어요', d.reason || ' · 24시간 안에 확인해 주세요', '/settlements'
    FROM due d CROSS JOIN users u WHERE u.role = 'operator'
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM due;
  RETURN v_n;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dudu-report-deadline';
SELECT cron.schedule('dudu-report-deadline', '0 0 * * *', 'SELECT fn_alert_report_deadline();');
