-- 광고하기(연결자 홍보 키트). 이 파일 하나를 통째로 실행하면 된다. 여러 번 실행해도 안전하다.

-- ───────── 3단계: 공유 문구 템플릿 (운영자가 관리, 연결자는 복사만) ─────────
CREATE TABLE IF NOT EXISTS share_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,            -- {link} 자리에 초대 링크가 들어간다 (없으면 끝에 붙음)
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE share_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS share_templates_all ON share_templates;
CREATE POLICY share_templates_all ON share_templates FOR ALL USING (true) WITH CHECK (true);

INSERT INTO share_templates (title, body, sort_order)
SELECT * FROM (VALUES
  ('지인에게', E'요즘 소개 제대로 해주는 데가 없어서 내가 직접 하고 있어.\n관심 있으면 프로필 한번 봐봐 👇\n{link}', 1),
  ('모임 공지', E'[소개팅 주선 안내]\n우리 모임 분들을 다른 모임의 좋은 분들과 이어드리고 있어요.\n관심 있는 분은 아래 링크에서 가입해 주세요 👇\n{link}', 2),
  ('짧게', E'소개팅 받아볼 생각 있으면 여기로 가입해줘! 내가 직접 챙겨줄게 🙂\n{link}', 3),
  ('정중하게', E'안녕하세요. 지인 소개로 만남을 주선하고 있습니다.\n부담 없이 프로필을 등록해 주시면 제가 연락드릴게요.\n{link}', 4)
) AS v(title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM share_templates);

-- ───────── 4단계: 파트너 소개 글 검수 + 과장 표현 차단 ─────────
-- 경력·파트너 소개·서비스 설명을 고치면 검수 대기(pending_profile)에 저장되고,
-- 운영자가 승인하기 전까지 회원에게는 이전 승인본이 보인다.
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS pending_profile JSONB;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS profile_status TEXT NOT NULL DEFAULT 'APPROVED'; -- APPROVED | PENDING | REJECTED
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS profile_reject_reason TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS profile_reviewed_at TIMESTAMPTZ;

-- 결혼중개업법상 거짓·과장 광고가 될 수 있는 표현 (띄어쓰기 무시). 앱의 src/lib/adPolicy.ts 와 같은 목록
CREATE OR REPLACE FUNCTION fn_banned_ad_word(p_text TEXT) RETURNS TEXT AS $$
DECLARE
  w TEXT;
  t TEXT := lower(regexp_replace(COALESCE(p_text, ''), '\s', '', 'g'));
BEGIN
  FOREACH w IN ARRAY ARRAY['성혼율','성혼률','성공률','100%','100프로','백퍼','보장','확실','무조건','1위','업계최초','유일한','완벽한','결혼성공'] LOOP
    IF position(w IN t) > 0 THEN RETURN w; END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_check_pending_profile() RETURNS TRIGGER AS $$
DECLARE
  w TEXT;
BEGIN
  IF NEW.pending_profile IS NOT NULL THEN
    w := fn_banned_ad_word(concat_ws(' ', NEW.pending_profile->>'career', NEW.pending_profile->>'intro', NEW.pending_profile->>'service_description'));
    IF w IS NOT NULL THEN
      RAISE EXCEPTION 'BANNED_WORD:%', w;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS connectors_pending_profile_check ON connectors;
CREATE TRIGGER connectors_pending_profile_check
  BEFORE INSERT OR UPDATE OF pending_profile ON connectors
  FOR EACH ROW EXECUTE FUNCTION fn_check_pending_profile();

-- 운영자 검수: 승인하면 대기본을 공개본으로 옮기고, 반려하면 사유를 남긴다. 파트너에게 알림.
DROP FUNCTION IF EXISTS fn_review_connector_profile(UUID, BOOLEAN, TEXT);
-- p_expected: 운영자가 화면에서 본 대기본. 그 사이 파트너가 또 고쳤으면 처리하지 않는다 (안 본 글이 승인되지 않게)
CREATE OR REPLACE FUNCTION fn_review_connector_profile(p_connector_id UUID, p_approve BOOLEAN, p_reason TEXT DEFAULT NULL, p_expected JSONB DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  c connectors%ROWTYPE;
BEGIN
  SELECT * INTO c FROM connectors WHERE id = p_connector_id FOR UPDATE;
  IF NOT FOUND OR c.pending_profile IS NULL OR c.profile_status <> 'PENDING'
     OR (p_expected IS NOT NULL AND c.pending_profile IS DISTINCT FROM p_expected) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  IF p_approve THEN
    UPDATE connectors SET
      career = CASE WHEN c.pending_profile ? 'career' THEN NULLIF(c.pending_profile->>'career', '') ELSE career END,
      intro = CASE WHEN c.pending_profile ? 'intro' THEN NULLIF(c.pending_profile->>'intro', '') ELSE intro END,
      service_description = CASE WHEN c.pending_profile ? 'service_description' THEN NULLIF(c.pending_profile->>'service_description', '') ELSE service_description END,
      pending_profile = NULL, profile_status = 'APPROVED', profile_reject_reason = NULL, profile_reviewed_at = now()
    WHERE id = p_connector_id;
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (p_connector_id, 'profile_approved', '소개 글이 승인되었어요', '이제 회원들에게 새 소개 글이 보여요', '/profile');
  ELSE
    UPDATE connectors SET profile_status = 'REJECTED', profile_reject_reason = NULLIF(trim(COALESCE(p_reason, '')), ''), profile_reviewed_at = now()
    WHERE id = p_connector_id;
    INSERT INTO notifications (user_id, type, title, body, deep_link_route)
    VALUES (p_connector_id, 'profile_rejected', '소개 글이 반려되었어요', COALESCE(NULLIF(trim(p_reason), ''), '마이 › 커리어 프로필에서 수정해 주세요'), '/profile');
  END IF;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- ───────── 5~6단계: 코드 초대 링크(/c/코드) + 성과 집계 ─────────
-- 링크 코드: 헷갈리는 글자(0·O·1·I)를 뺀 대문자 8자리. 대소문자 구분 없이 찾도록 대문자로만 저장한다.
-- 한 파트너가 링크를 여러 개 가질 수 있다 (지금 화면은 가장 최근 링크 하나를 쓴다).
CREATE TABLE IF NOT EXISTS invite_links (
  code TEXT PRIMARY KEY CHECK (code = upper(code) AND length(code) = 8),
  connector_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_links_connector_idx ON invite_links(connector_id, created_at DESC);
ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invite_links_all ON invite_links;
CREATE POLICY invite_links_all ON invite_links FOR ALL USING (true) WITH CHECK (true);

-- 성과 기록: 링크 열람(CLICK) · 가입(SIGNUP) · 가입 신청(APPLIED) · 승인(APPROVED). IP는 저장하지 않는다.
CREATE TABLE IF NOT EXISTS invite_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL REFERENCES invite_links(code) ON DELETE CASCADE,
  connector_id UUID NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('CLICK', 'SIGNUP', 'APPLIED', 'APPROVED')),
  session_id TEXT,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 같은 방문(세션)에서 여러 번 열어도 열람 1번, 같은 회원의 가입·신청·승인도 1번만 센다
CREATE UNIQUE INDEX IF NOT EXISTS invite_events_session_uniq ON invite_events(code, event, session_id) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invite_events_user_uniq ON invite_events(code, event, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invite_events_connector_idx ON invite_events(connector_id, created_at DESC);
ALTER TABLE invite_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invite_events_all ON invite_events;
CREATE POLICY invite_events_all ON invite_events FOR ALL USING (true) WITH CHECK (true);

-- 가입 신청이 어떤 링크로 들어왔는지
ALTER TABLE hopeful_requests ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- 파트너의 링크 코드 (없으면 새로 만든다)
CREATE OR REPLACE FUNCTION fn_get_or_create_invite_code(p_connector_id UUID) RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i INT;
BEGIN
  SELECT code INTO v_code FROM invite_links WHERE connector_id = p_connector_id AND is_active ORDER BY created_at DESC LIMIT 1;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(chars, 1 + floor(random() * length(chars))::INT, 1);
    END LOOP;
    BEGIN
      INSERT INTO invite_links (code, connector_id) VALUES (v_code, p_connector_id);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- 드물게 겹치면 다시 뽑는다
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 성과 기록 (같은 세션·같은 회원 중복은 조용히 무시)
CREATE OR REPLACE FUNCTION fn_track_invite(p_code TEXT, p_event TEXT, p_session_id TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_connector UUID;
BEGIN
  SELECT connector_id INTO v_connector FROM invite_links WHERE code = upper(p_code);
  IF v_connector IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_link'); END IF;
  IF p_user_id IS NULL AND p_session_id IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  INSERT INTO invite_events (code, connector_id, event, session_id, user_id)
  VALUES (upper(p_code), v_connector, p_event, p_session_id, p_user_id)
  ON CONFLICT DO NOTHING;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

-- 링크로 들어온 가입 신청·승인은 자동으로 기록한다
CREATE OR REPLACE FUNCTION fn_track_invite_request() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invite_code IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_track_invite(NEW.invite_code, 'APPLIED', NULL, NEW.hopeful_id);
  ELSIF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    PERFORM fn_track_invite(NEW.invite_code, 'APPROVED', NULL, NEW.hopeful_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hopeful_requests_invite_track ON hopeful_requests;
CREATE TRIGGER hopeful_requests_invite_track
  AFTER INSERT OR UPDATE OF status ON hopeful_requests
  FOR EACH ROW EXECUTE FUNCTION fn_track_invite_request();

-- 파트너 화면용 집계: 전체 합계 + 최근 30일 일별
CREATE OR REPLACE FUNCTION fn_invite_stats(p_connector_id UUID) RETURNS JSON AS $$
  SELECT json_build_object(
    'totals', (
      SELECT json_build_object(
        'CLICK', count(*) FILTER (WHERE event = 'CLICK'),
        'SIGNUP', count(*) FILTER (WHERE event = 'SIGNUP'),
        'APPLIED', count(*) FILTER (WHERE event = 'APPLIED'),
        'APPROVED', count(*) FILTER (WHERE event = 'APPROVED'))
      FROM invite_events WHERE connector_id = p_connector_id),
    'daily', (
      SELECT COALESCE(json_agg(json_build_object('d', d::DATE, 'CLICK', c, 'APPLIED', a) ORDER BY d), '[]'::json)
      FROM (
        SELECT g.d,
          (SELECT count(*) FROM invite_events e WHERE e.connector_id = p_connector_id AND e.event = 'CLICK' AND (e.created_at AT TIME ZONE 'Asia/Seoul')::DATE = g.d::DATE) AS c,
          (SELECT count(*) FROM invite_events e WHERE e.connector_id = p_connector_id AND e.event = 'APPLIED' AND (e.created_at AT TIME ZONE 'Asia/Seoul')::DATE = g.d::DATE) AS a
        FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::DATE - 29, (now() AT TIME ZONE 'Asia/Seoul')::DATE, '1 day') AS g(d)
      ) s)
  );
$$ LANGUAGE sql STABLE;

-- ───────── 7단계: 사업자 정보(플랫폼 설정) ─────────
-- 운영자가 앱 '설정 › 사업자 정보'에서 입력한다. 화면 하단 사업자 정보·약관에 쓰이고,
-- 국내결혼중개업 신고번호(business_report_number)가 비어 있으면 초대 링크에 파트너 소개(광고)를 보여주지 않는다.
CREATE TABLE IF NOT EXISTS platform_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT,
  representative TEXT,
  business_registration_number TEXT,
  mail_order_number TEXT,
  business_report_number TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  privacy_officer TEXT,
  privacy_contact TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_settings_all ON platform_settings;
CREATE POLICY platform_settings_all ON platform_settings FOR ALL USING (true) WITH CHECK (true);
