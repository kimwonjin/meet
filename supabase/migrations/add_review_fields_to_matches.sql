-- Add review completion fields to matches table
ALTER TABLE matches
ADD COLUMN IF NOT EXISTS review_1_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS review_2_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS final_completed_at TIMESTAMPTZ;

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS matches_review_status_idx ON matches(review_1_completed, review_2_completed);
