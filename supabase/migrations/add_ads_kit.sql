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
CREATE OR REPLACE FUNCTION fn_review_connector_profile(p_connector_id UUID, p_approve BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  c connectors%ROWTYPE;
BEGIN
  SELECT * INTO c FROM connectors WHERE id = p_connector_id FOR UPDATE;
  IF NOT FOUND OR c.pending_profile IS NULL OR c.profile_status <> 'PENDING' THEN
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
