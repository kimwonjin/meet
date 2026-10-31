-- 종사자 변경신고 기록: 운영자가 '구청에 변경신고 했어요'를 누른 때의 파트너 명단 (어느 기기에서 봐도 같게)
-- 실행 전에도 앱은 그대로 동작한다 (그 기기에만 기록)
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS staff_reported JSONB;
