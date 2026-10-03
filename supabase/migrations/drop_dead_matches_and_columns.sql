-- 코드 정리 과정에서 확인된, 앱 어디서도 더 이상 참조하지 않는 것들을 제거한다.

-- matches 테이블: match_requests 리디자인 이전 구조의 잔재. 이 테이블에 쓰던 유일한 코드
-- (connectors.tsx의 죽은 handleMatchApprove)를 이미 삭제했고, 남은 11건은 레거시 테스트 데이터뿐이다.
DROP TABLE IF EXISTS matches;

-- match_requests의 미사용 컬럼: 이전 설계 개편(review 단계, after-care 자동만료 등) 과정에서
-- 추가됐지만 실제로는 앱 코드 어디서도 읽거나 쓰지 않는 컬럼들.
ALTER TABLE match_requests
  DROP COLUMN IF EXISTS payment_status,
  DROP COLUMN IF EXISTS final_status,
  DROP COLUMN IF EXISTS review_1_completed,
  DROP COLUMN IF EXISTS review_2_completed,
  DROP COLUMN IF EXISTS hopeful_1_completed,
  DROP COLUMN IF EXISTS hopeful_2_completed,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS after_care_auto_expired_1,
  DROP COLUMN IF EXISTS after_care_auto_expired_2,
  DROP COLUMN IF EXISTS meeting_scheduled_at,
  DROP COLUMN IF EXISTS meeting_started_at;
