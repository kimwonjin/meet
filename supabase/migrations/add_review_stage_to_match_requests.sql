-- Add review stage fields to match_requests table
ALTER TABLE match_requests
ADD COLUMN IF NOT EXISTS review_1_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS review_2_completed BOOLEAN DEFAULT false;

-- Create index for review stage filtering
CREATE INDEX IF NOT EXISTS match_requests_review_stage_idx ON match_requests(review_1_completed, review_2_completed);
