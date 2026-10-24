-- 회사 + 아는 사람 피하기
-- 1) users.company: 회사명 (파트너에게만 보임), users.avoid_same_company: 같은 회사 사람은 소개받지 않기
--    users.job_category: 직업 분류, users.extra_conditions: 해당하는 조건 (둘 다 파트너에게만 보임)
-- 2) avoid_contacts: 피하고 싶은 사람의 전화번호 (되돌릴 수 없는 값으로만 저장 → 원래 번호는 남지 않음)
-- 3) fn_avoid_pairs(회원들): 서로 소개하면 안 되는 두 사람 목록 (누가 누구를 피하는지는 알려주지 않는다)
-- 4) 탈퇴할 때 위 정보와 피할 번호·파트너 메모·알림 등록·원하는 상대를 함께 지운다
-- 실행 전에는 앱이 회사 칸·피하기 메뉴만 보여주지 않고 나머지는 그대로 동작한다

ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avoid_same_company BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_category TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_conditions TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS avoid_contacts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_hash TEXT NOT NULL,
  label TEXT,              -- 화면에 보여줄 뒷자리 (예: ****-5678)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS avoid_contacts_hash_idx ON avoid_contacts(phone_hash);
ALTER TABLE avoid_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS avoid_contacts_all ON avoid_contacts;
CREATE POLICY avoid_contacts_all ON avoid_contacts FOR ALL USING (true) WITH CHECK (true);

-- 회사 이름 비교용: 띄어쓰기·(주)·주식회사·점·쉼표를 빼고 소문자로
CREATE OR REPLACE FUNCTION fn_company_key(c TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(c, ''), '(주식회사|\(주\)|㈜|\s|\.|,)', '', 'g')), '');
$$;

-- 앱과 같은 방식의 번호 값 (SHA-256('dudu:' + 숫자만))
CREATE OR REPLACE FUNCTION fn_phone_hash(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('dudu:' || regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION fn_avoid_pairs(p_ids UUID[]) RETURNS TABLE(a UUID, b UUID)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- 번호로 피하기 (한쪽만 등록해도 서로 소개되지 않음)
  SELECT LEAST(ac.user_id, u.id), GREATEST(ac.user_id, u.id)
  FROM avoid_contacts ac
  JOIN users u ON fn_phone_hash(u.phone) = ac.phone_hash
  WHERE ac.user_id = ANY(p_ids) AND u.id = ANY(p_ids) AND u.id <> ac.user_id
  UNION
  -- 같은 회사 (둘 중 한 명이라도 '같은 회사 피하기'를 켰을 때)
  SELECT LEAST(x.id, y.id), GREATEST(x.id, y.id)
  FROM users x JOIN users y ON x.id < y.id AND fn_company_key(x.company) = fn_company_key(y.company)
  WHERE x.id = ANY(p_ids) AND y.id = ANY(p_ids) AND (x.avoid_same_company OR y.avoid_same_company);
$$;

-- 탈퇴하면 회사·직업 분류·해당 조건·원하는 상대·피할 번호·파트너 메모·휴대폰 알림 등록도 바로 지운다
-- (fn_withdraw_user가 withdrawn_at을 채우는 순간 함께 실행)
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
    DELETE FROM avoid_contacts WHERE user_id = NEW.id;
    DELETE FROM member_notes WHERE hopeful_id = NEW.id OR connector_id = NEW.id;
    DELETE FROM push_subscriptions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clear_withdrawn_extras ON users;
CREATE TRIGGER trg_clear_withdrawn_extras BEFORE UPDATE OF withdrawn_at ON users
  FOR EACH ROW EXECUTE FUNCTION fn_clear_withdrawn_extras();
