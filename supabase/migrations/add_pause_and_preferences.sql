-- 회원 '잠시 쉬기'와 '원하는 상대'
-- 1) paused_at: 소개를 잠시 쉬기 시작한 시각 (비어 있으면 소개받는 중)
-- 2) preferences: 원하는 상대 (나이대·사는 곳·키·흡연). 파트너가 후보를 고를 때 참고한다
-- 실행 전에는 앱이 두 메뉴만 보여주지 않고 나머지는 그대로 동작한다
ALTER TABLE users ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB;
