-- 휴대폰 알림(웹 푸시)
-- 1) 알림을 켠 기기 목록 (기기 한 대 = 한 줄. 같은 기기에서 다른 계정으로 로그인하면 그 계정으로 바뀐다)
-- 2) 알림 서명 키 (처음 알림을 켤 때 서버가 한 번 만들어 저장)
-- 3) 알림·채팅 메시지가 저장되면 /api/push 를 불러 휴대폰으로 보낸다 (보내기에 실패해도 저장은 그대로)
-- 실행 전에는 앱이 '알림 켜기'만 보여주지 않고 나머지는 그대로 동작한다

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_all ON push_subscriptions;
CREATE POLICY push_subscriptions_all ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS push_keys (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE push_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_keys_all ON push_keys;
CREATE POLICY push_keys_all ON push_keys FOR ALL USING (true) WITH CHECK (true);

-- 같은 건을 두 번 보내지 않도록 보낸 시각을 남긴다
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

-- DB에서 바깥 주소를 부르는 기능
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION fn_push_on_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    -- 배포 주소가 바뀌면 이 주소만 바꾸면 된다
    PERFORM net.http_post(
      url := 'https://meet-six-psi.vercel.app/api/push',
      body := jsonb_build_object('id', NEW.id, 'kind', CASE WHEN TG_TABLE_NAME = 'chat_messages' THEN 'chat' ELSE 'notification' END),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 20000 -- 채팅은 몇 초 기다렸다가 보내므로 넉넉하게
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- 보내기 요청이 실패해도 알림 저장은 막지 않는다
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_notification ON notifications;
CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION fn_push_on_notification();

DROP TRIGGER IF EXISTS trg_push_on_chat_message ON chat_messages;
CREATE TRIGGER trg_push_on_chat_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_push_on_notification();
