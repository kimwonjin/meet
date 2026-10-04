-- 회원이 매칭을 마친 뒤 자기 파트너(연결자)에게 남기는 후기
-- 매칭 1건당 회원 1명이 1개만 남길 수 있다.
CREATE TABLE IF NOT EXISTS connector_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  hopeful_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_request_id, hopeful_id)
);

CREATE INDEX IF NOT EXISTS connector_reviews_connector_idx ON connector_reviews(connector_id, created_at DESC);

-- 보안(RLS)은 추후 일괄 적용 예정. 지금은 다른 테이블과 동일하게 전체 허용.
ALTER TABLE connector_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_reviews_all ON connector_reviews;
CREATE POLICY connector_reviews_all ON connector_reviews FOR ALL USING (true) WITH CHECK (true);
