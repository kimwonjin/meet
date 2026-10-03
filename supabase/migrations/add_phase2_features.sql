-- ============================================================
-- 2단계: 신용지표 / 일정관리 / 계좌·출금 / 채팅 / 위촉승인 게이트
-- ============================================================

-- 1) 신용지표: 매칭 성사율 + 노쇼/분쟁 비율 + 활동량(균등 가중치)
CREATE OR REPLACE FUNCTION fn_get_credit_score(p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  v_total_proposed INT;
  v_settled INT;
  v_noshow_dispute INT;
  v_total_matches INT;
  v_success_score NUMERIC;
  v_trust_score NUMERIC;
  v_activity_score NUMERIC;
  v_overall NUMERIC;
  v_grade TEXT;
BEGIN
  SELECT count(*) INTO v_total_proposed FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id) AND status != 'rejected';

  SELECT count(*) INTO v_settled FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id) AND settlement_completed = true;

  SELECT count(*) INTO v_total_matches FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id) AND meeting_status = 'completed';

  SELECT count(*) INTO v_noshow_dispute FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id)
      AND (after_care_hopeful_1 = '노쇼신고' OR after_care_hopeful_2 = '노쇼신고');

  v_success_score := CASE WHEN v_total_proposed = 0 THEN 0 ELSE LEAST(100, (v_settled::NUMERIC / v_total_proposed) * 100) END;
  v_trust_score := CASE WHEN v_total_matches = 0 THEN 100 ELSE GREATEST(0, 100 - (v_noshow_dispute::NUMERIC / v_total_matches) * 100) END;
  -- ponytail: 활동점수는 완료 10건을 만점으로 두는 단순 선형 스케일. 데이터가 쌓이면 분포 보고 곡선 조정할 것.
  v_activity_score := LEAST(100, (v_settled::NUMERIC / 10) * 100);

  v_overall := (v_success_score + v_trust_score + v_activity_score) / 3;

  v_grade := CASE
    WHEN v_total_proposed = 0 THEN 'new'
    WHEN v_overall >= 90 THEN '골드'
    WHEN v_overall >= 70 THEN '실버'
    WHEN v_overall >= 50 THEN '브론즈'
    ELSE 'new'
  END;

  RETURN json_build_object(
    'success_score', ROUND(v_success_score),
    'trust_score', ROUND(v_trust_score),
    'activity_score', ROUND(v_activity_score),
    'overall_score', ROUND(v_overall),
    'grade', v_grade,
    'total_proposed', v_total_proposed,
    'settled_count', v_settled,
    'noshow_dispute_count', v_noshow_dispute
  );
END;
$$ LANGUAGE plpgsql;

-- 2) 일정관리: 확정 일정 시각 (기존에 있다가 미사용으로 정리했던 컬럼을 실제 기능과 함께 재도입)
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS meeting_scheduled_at TIMESTAMPTZ;

-- 3) 계좌정보 + 출금신청 (신청 -> 운영자 수동 처리)
CREATE TABLE IF NOT EXISTS connector_bank_accounts (
  connector_id UUID PRIMARY KEY REFERENCES users(id),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE connector_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_bank_accounts_allow_all ON connector_bank_accounts;
CREATE POLICY connector_bank_accounts_allow_all ON connector_bank_accounts FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS withdrawal_requests_connector_idx ON withdrawal_requests(connector_id);
CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx ON withdrawal_requests(status);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS withdrawal_requests_allow_all ON withdrawal_requests;
CREATE POLICY withdrawal_requests_allow_all ON withdrawal_requests FOR ALL USING (true) WITH CHECK (true);

-- 4) 위촉 온보딩 승인: connectors.status 컬럼은 이미 존재한다 (지금까지 가입 즉시 'approved'로 하드코딩되던 것을
--    앱 코드에서 'pending'으로 바꾸고, 운영자 승인 화면에서 승인 시 role을 connector로 전환하도록 변경한다.
--    스키마 변경은 필요 없음 — 참고용 주석.

-- 5) 채팅
CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1_id UUID NOT NULL REFERENCES users(id),
  participant_2_id UUID NOT NULL REFERENCES users(id),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  p1_last_read_at TIMESTAMPTZ,
  p2_last_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_pair_idx ON chat_threads (LEAST(participant_1_id, participant_2_id), GREATEST(participant_1_id, participant_2_id));
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_threads_allow_all ON chat_threads;
CREATE POLICY chat_threads_allow_all ON chat_threads FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id, created_at);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_messages_allow_all ON chat_messages;
CREATE POLICY chat_messages_allow_all ON chat_messages FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_touch_chat_thread() RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_threads SET last_message_at = NEW.created_at, last_message_preview = LEFT(NEW.content, 100)
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_chat_thread ON chat_messages;
CREATE TRIGGER trg_touch_chat_thread AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION fn_touch_chat_thread();

CREATE OR REPLACE FUNCTION fn_get_or_create_thread(p_user_a UUID, p_user_b UUID)
RETURNS UUID AS $$
DECLARE
  v_thread_id UUID;
BEGIN
  SELECT id INTO v_thread_id FROM chat_threads
    WHERE (participant_1_id = p_user_a AND participant_2_id = p_user_b)
       OR (participant_1_id = p_user_b AND participant_2_id = p_user_a);
  IF v_thread_id IS NOT NULL THEN
    RETURN v_thread_id;
  END IF;

  INSERT INTO chat_threads (participant_1_id, participant_2_id)
  VALUES (p_user_a, p_user_b)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_thread_id;

  IF v_thread_id IS NULL THEN
    SELECT id INTO v_thread_id FROM chat_threads
      WHERE (participant_1_id = p_user_a AND participant_2_id = p_user_b)
         OR (participant_1_id = p_user_b AND participant_2_id = p_user_a);
  END IF;

  RETURN v_thread_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_get_unread_message_count(p_user_id UUID)
RETURNS INT AS $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM chat_messages m
  JOIN chat_threads t ON t.id = m.thread_id
  WHERE m.sender_id != p_user_id
    AND (
      (t.participant_1_id = p_user_id AND (t.p1_last_read_at IS NULL OR m.created_at > t.p1_last_read_at))
      OR
      (t.participant_2_id = p_user_id AND (t.p2_last_read_at IS NULL OR m.created_at > t.p2_last_read_at))
    );
  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql;
