-- 동맹 연결자 회원과의 매칭 시, 상대 연결자의 동의를 받는 단계를 추가한다.
-- 기존 매칭(같은 연결자끼리, 또는 이미 생성된 매칭)은 default true로 영향받지 않는다.
ALTER TABLE match_requests
ADD COLUMN IF NOT EXISTS proposer_connector_id UUID,
ADD COLUMN IF NOT EXISTS connector_1_consented BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS connector_2_consented BOOLEAN NOT NULL DEFAULT true;
