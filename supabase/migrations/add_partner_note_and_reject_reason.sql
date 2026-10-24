-- 파트너 한마디 + 거절 이유
-- partner_note: 매칭을 제안할 때 파트너가 두 회원에게 남기는 한 줄 (두 회원 모두에게 보임)
-- reject_reason: 회원이 소개를 거절할 때 고른 이유 (선택, 파트너에게만 보임. 상대 회원에게는 알리지 않음)
-- 실행 전에는 한마디 칸이 저장되지 않고, 거절 이유는 파트너 알림에만 담긴다 (나머지는 그대로 동작)

ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS partner_note TEXT CHECK (char_length(partner_note) <= 100);
ALTER TABLE match_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT CHECK (char_length(reject_reason) <= 200);
