-- 신고·차단 (앱스토어 심사 요건: 이용자를 신고하고 차단할 수 있어야 한다)
-- 신고: 운영자가 확인하도록 쌓아 두고 운영자에게 알린다
-- 차단: 차단한 두 회원은 다시 매칭되지 않는다 (누가 차단했는지는 파트너에게 알리지 않는다)

CREATE TABLE IF NOT EXISTS user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context TEXT NOT NULL,            -- 'match' | 'chat' | 'partner'
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'resolved'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_reports_status_idx ON user_reports(status, created_at DESC);
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_reports_all ON user_reports;
CREATE POLICY user_reports_all ON user_reports FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked_id);
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_blocks_all ON user_blocks;
CREATE POLICY user_blocks_all ON user_blocks FOR ALL USING (true) WITH CHECK (true);

-- 신고 접수 + 운영자 알림
CREATE OR REPLACE FUNCTION fn_report_user(p_reporter_id UUID, p_target_id UUID, p_context TEXT, p_reason TEXT, p_detail TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_reporter_id = p_target_id THEN
    RETURN json_build_object('ok', false, 'reason', 'self');
  END IF;

  INSERT INTO user_reports (reporter_id, target_id, context, reason, detail)
  VALUES (p_reporter_id, p_target_id, p_context, p_reason, NULLIF(trim(COALESCE(p_detail, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO notifications (user_id, type, title, body, deep_link_route)
  SELECT u.id, 'user_reported', '새 신고가 접수되었습니다', p_reason, '/settlements'
  FROM users u WHERE u.role = 'operator';

  RETURN json_build_object('ok', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql;

-- 차단한 두 회원은 매칭 제안이 만들어지지 않는다 (fn_propose_match 안에서도 막힌다)
CREATE OR REPLACE FUNCTION fn_check_match_block() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = NEW.hopeful_1_id AND b.blocked_id = NEW.hopeful_2_id)
       OR (b.blocker_id = NEW.hopeful_2_id AND b.blocked_id = NEW.hopeful_1_id)
  ) THEN
    RAISE EXCEPTION 'BLOCKED_PAIR';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS match_requests_block_check ON match_requests;
CREATE TRIGGER match_requests_block_check
  BEFORE INSERT ON match_requests
  FOR EACH ROW EXECUTE FUNCTION fn_check_match_block();
