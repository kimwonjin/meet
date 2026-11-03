-- 원하는 만남 (천천히 알아가고 싶어요 / 진지하게 만나고 싶어요 / 결혼까지 생각해요). 파트너에게만 보인다
ALTER TABLE users ADD COLUMN IF NOT EXISTS meet_intent TEXT;

-- 탈퇴하면 원하는 만남·다음 바람도 지운다 (다른 추가 정보와 함께)
CREATE OR REPLACE FUNCTION fn_clear_withdrawn_extras() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL THEN
    NEW.company := NULL;
    NEW.avoid_same_company := false;
    NEW.job_category := NULL;
    NEW.extra_conditions := '{}';
    NEW.preferences := NULL;
    NEW.paused_at := NULL;
    NEW.meet_intent := NULL;
    NEW.next_wish := NULL;
    DELETE FROM avoid_contacts WHERE user_id = NEW.id;
    DELETE FROM member_notes WHERE hopeful_id = NEW.id OR connector_id = NEW.id;
    DELETE FROM push_subscriptions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
