-- 운영자 이용 정지: 정지된 사람은 로그인할 수 없고, 새 매칭에 넣을 수 없다
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- 매칭 제안 시 차단(BLOCKED_PAIR)에 더해 정지된 회원도 막는다
CREATE OR REPLACE FUNCTION fn_check_match_block() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = NEW.hopeful_1_id AND b.blocked_id = NEW.hopeful_2_id)
       OR (b.blocker_id = NEW.hopeful_2_id AND b.blocked_id = NEW.hopeful_1_id)
  ) THEN
    RAISE EXCEPTION 'BLOCKED_PAIR';
  END IF;
  IF EXISTS (
    SELECT 1 FROM users u
    WHERE u.id IN (NEW.hopeful_1_id, NEW.hopeful_2_id, NEW.connector_1_id, NEW.connector_2_id)
      AND u.suspended_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SUSPENDED_USER';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
