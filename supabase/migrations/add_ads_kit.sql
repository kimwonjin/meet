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
