-- Add 'completed' status to match_requests
ALTER TABLE match_requests
DROP CONSTRAINT IF EXISTS match_requests_status_check;

ALTER TABLE match_requests
ADD CONSTRAINT match_requests_status_check
CHECK (status IN ('pending', 'approved', 'completed'));

-- Create payments table if it doesn't exist
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_request_id UUID NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  hopeful_1_id UUID NOT NULL REFERENCES users(id),
  hopeful_2_id UUID NOT NULL REFERENCES users(id),
  connector_1_id UUID NOT NULL REFERENCES users(id),
  connector_2_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, completed, failed
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS payments_match_request_id_idx ON payments(match_request_id);
CREATE INDEX IF NOT EXISTS payments_hopeful_1_id_idx ON payments(hopeful_1_id);
CREATE INDEX IF NOT EXISTS payments_hopeful_2_id_idx ON payments(hopeful_2_id);
