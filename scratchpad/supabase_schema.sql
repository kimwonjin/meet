-- 사용자 테이블 (포망자)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  gender TEXT NOT NULL, -- M, F
  role TEXT NOT NULL DEFAULT 'hopeful', -- hopeful, connector
  grade TEXT DEFAULT 'new', -- new, bronze, silver, gold, master
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 연결자 정보
CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY REFERENCES users(id),
  business_name TEXT,
  verified BOOLEAN DEFAULT FALSE,
  commission_rate NUMERIC DEFAULT 80,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 포망자-연결자 가입 관계
CREATE TABLE IF NOT EXISTS hopeful_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending', -- pending, approved, rejected
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(hopeful_id, connector_id)
);

-- 연결자 간 동맹 관계
CREATE TABLE IF NOT EXISTS connector_alliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_a UUID NOT NULL REFERENCES connectors(id),
  connector_b UUID NOT NULL REFERENCES connectors(id),
  status TEXT DEFAULT 'pending', -- pending, active, inactive
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (connector_a < connector_b),
  UNIQUE(connector_a, connector_b)
);

-- 이용권
CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 매칭
CREATE TABLE IF NOT EXISTS matchings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connectors(id),
  hopeful_a UUID NOT NULL REFERENCES users(id),
  hopeful_b UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, -- internal, alliance
  alliance_connector_id UUID REFERENCES connectors(id), -- alliance인 경우만
  status TEXT DEFAULT 'pending', -- pending, confirmed, completed, cancelled
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 매칭 요청 (포망자가 연결자에게 보내는 요청)
CREATE TABLE IF NOT EXISTS matching_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hopeful_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  age_min INTEGER,
  age_max INTEGER,
  location TEXT,
  note TEXT,
  status TEXT DEFAULT 'pending', -- pending, accepted, rejected
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 리뷰
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matching_id UUID NOT NULL REFERENCES matchings(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  satisfaction INTEGER, -- 1-5
  no_show BOOLEAN DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 신뢰지표
CREATE TABLE IF NOT EXISTS trust_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  satisfaction_rate NUMERIC DEFAULT 0, -- 25%
  completion_rate NUMERIC DEFAULT 0, -- 20%
  rematch_rate NUMERIC DEFAULT 0, -- 20%
  retention_rate NUMERIC DEFAULT 0, -- 15%
  response_time NUMERIC DEFAULT 0, -- 10%
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(connector_id)
);

-- 정산
CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connectors(id),
  matching_id UUID NOT NULL REFERENCES matchings(id),
  amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, completed
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
