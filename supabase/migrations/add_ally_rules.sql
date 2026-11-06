-- 동맹 받는 조건 (회원 수 n명 이상, 같은 지역만, 요청 받기 켜기/끄기)
-- 예: {"minMembers": 10, "sameRegion": true, "accepting": true}
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS ally_rules JSONB;
