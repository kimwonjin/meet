-- Redesign match_requests table for v2 timeline
-- This migration restructures match_requests to support the new 4-stage flow:
-- 1. 매칭 (제안)
-- 2. 참여 (승인/거절)
-- 3. 애프터의사 (신청/미신청/노쇼신고)
-- 4. 매칭종료 (성사/종료/노쇼처리)

-- Drop old constraint
ALTER TABLE match_requests
DROP CONSTRAINT IF EXISTS match_requests_status_check;

-- Add new columns for v2 flow
ALTER TABLE match_requests
-- 2단계: 참여 의사
ADD COLUMN IF NOT EXISTS hopeful_1_approved BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS hopeful_2_approved BOOLEAN DEFAULT false,

-- 3단계: 애프터의사 (신청/미신청/노쇼신고)
ADD COLUMN IF NOT EXISTS after_care_hopeful_1 TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS after_care_hopeful_2 TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS after_care_auto_expired_1 BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS after_care_auto_expired_2 BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS after_care_requested_at_1 TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS after_care_requested_at_2 TIMESTAMPTZ,

-- 연결자 3단계: 소개팅 진행 (announced/in_progress/completed)
ADD COLUMN IF NOT EXISTS meeting_status TEXT DEFAULT 'announced',
ADD COLUMN IF NOT EXISTS meeting_scheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS meeting_started_at TIMESTAMPTZ,

-- 4단계 결과
ADD COLUMN IF NOT EXISTS settlement_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS settlement_completed_at TIMESTAMPTZ,

-- 최종 상태 (pending/approved/rejected/completed)
ADD COLUMN IF NOT EXISTS final_status TEXT DEFAULT 'pending';

-- Update constraint to include new status values
ALTER TABLE match_requests
ADD CONSTRAINT match_requests_status_check
CHECK (status IN ('pending', 'approved', 'rejected', 'completed'));

-- Add constraint for after_care values
ALTER TABLE match_requests
ADD CONSTRAINT match_requests_after_care_check
CHECK (
  after_care_hopeful_1 IS NULL OR after_care_hopeful_1 IN ('신청', '미신청', '노쇼신고'),
  after_care_hopeful_2 IS NULL OR after_care_hopeful_2 IN ('신청', '미신청', '노쇼신고')
);

-- Add constraint for meeting_status
ALTER TABLE match_requests
ADD CONSTRAINT match_requests_meeting_status_check
CHECK (meeting_status IN ('announced', 'in_progress', 'completed'));

-- Create indexes for faster filtering
CREATE INDEX IF NOT EXISTS match_requests_hopeful_approved_idx
ON match_requests(hopeful_1_approved, hopeful_2_approved);

CREATE INDEX IF NOT EXISTS match_requests_after_care_idx
ON match_requests(after_care_hopeful_1, after_care_hopeful_2);

CREATE INDEX IF NOT EXISTS match_requests_meeting_status_idx
ON match_requests(meeting_status);

CREATE INDEX IF NOT EXISTS match_requests_settlement_idx
ON match_requests(settlement_completed);

-- Create timestamp index for 72-hour timeout queries
CREATE INDEX IF NOT EXISTS match_requests_after_care_timeout_idx
ON match_requests(after_care_requested_at_1, after_care_requested_at_2);
