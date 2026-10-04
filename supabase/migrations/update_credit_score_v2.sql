-- 신뢰지표 v2
-- 1) 노쇼로 종료된 매칭은 성사로 세지 않는다 (closed_reason = 'no_show')
-- 2) 진행 중인 매칭은 성사율 분모에서 뺀다 (끝난 매칭만으로 계산)
-- 3) 회원 후기 별점 반영 (회원 만족도)
-- 4) 애프터 성사율 반영 (두 회원 모두 '또 만나고 싶어요')
-- 데이터가 없는 항목(후기 0개, 성사 0건 등)은 종합 점수 평균에서 제외한다.

CREATE OR REPLACE FUNCTION fn_get_credit_score(p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  v_total_proposed INT;
  v_finished INT;
  v_in_progress INT;
  v_settled INT;
  v_meetings INT;
  v_noshow INT;
  v_mutual INT;
  v_review_count INT;
  v_review_avg NUMERIC;
  v_success_score NUMERIC;
  v_trust_score NUMERIC;
  v_activity_score NUMERIC;
  v_review_score NUMERIC;
  v_mutual_score NUMERIC;
  v_sum NUMERIC := 0;
  v_n INT := 0;
  v_overall NUMERIC;
  v_grade TEXT;
BEGIN
  -- 제안한 매칭 (거절 제외)
  SELECT count(*) INTO v_total_proposed FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id) AND status != 'rejected';

  -- 끝난 매칭 (정상 정산 + 노쇼 종료)
  SELECT count(*) INTO v_finished FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id)
      AND status != 'rejected' AND settlement_completed = true;
  v_in_progress := v_total_proposed - v_finished;

  -- 성사 = 정상 정산된 매칭 (노쇼 종료 제외)
  SELECT count(*) INTO v_settled FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id)
      AND settlement_completed = true AND closed_reason IS NULL;

  SELECT count(*) INTO v_meetings FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id) AND meeting_status = 'completed';

  SELECT count(*) INTO v_noshow FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id)
      AND (after_care_hopeful_1 = '노쇼신고' OR after_care_hopeful_2 = '노쇼신고');

  SELECT count(*) INTO v_mutual FROM match_requests
    WHERE (connector_1_id = p_connector_id OR connector_2_id = p_connector_id)
      AND settlement_completed = true AND closed_reason IS NULL
      AND after_care_hopeful_1 = '신청' AND after_care_hopeful_2 = '신청';

  SELECT count(*), avg(rating) INTO v_review_count, v_review_avg FROM connector_reviews
    WHERE connector_id = p_connector_id;

  v_success_score := CASE WHEN v_finished = 0 THEN NULL ELSE (v_settled::NUMERIC / v_finished) * 100 END;
  v_trust_score := CASE WHEN v_meetings = 0 THEN NULL ELSE GREATEST(0, 100 - (v_noshow::NUMERIC / v_meetings) * 100) END;
  v_activity_score := LEAST(100, (v_settled::NUMERIC / 10) * 100);
  v_review_score := CASE WHEN v_review_count = 0 THEN NULL ELSE (v_review_avg / 5) * 100 END;
  v_mutual_score := CASE WHEN v_settled = 0 THEN NULL ELSE (v_mutual::NUMERIC / v_settled) * 100 END;

  IF v_success_score IS NOT NULL THEN v_sum := v_sum + v_success_score; v_n := v_n + 1; END IF;
  IF v_trust_score IS NOT NULL THEN v_sum := v_sum + v_trust_score; v_n := v_n + 1; END IF;
  IF v_review_score IS NOT NULL THEN v_sum := v_sum + v_review_score; v_n := v_n + 1; END IF;
  IF v_mutual_score IS NOT NULL THEN v_sum := v_sum + v_mutual_score; v_n := v_n + 1; END IF;
  v_sum := v_sum + v_activity_score; v_n := v_n + 1;
  v_overall := v_sum / v_n;

  v_grade := CASE
    WHEN v_finished = 0 THEN 'new'
    WHEN v_overall >= 90 THEN '골드'
    WHEN v_overall >= 70 THEN '실버'
    WHEN v_overall >= 50 THEN '브론즈'
    ELSE 'new'
  END;

  RETURN json_build_object(
    'success_score', ROUND(v_success_score),
    'trust_score', ROUND(v_trust_score),
    'activity_score', ROUND(v_activity_score),
    'review_score', ROUND(v_review_score),
    'mutual_score', ROUND(v_mutual_score),
    'overall_score', ROUND(v_overall),
    'grade', v_grade,
    'total_proposed', v_total_proposed,
    'finished_count', v_finished,
    'in_progress_count', v_in_progress,
    'settled_count', v_settled,
    'noshow_dispute_count', v_noshow,
    'mutual_count', v_mutual,
    'review_count', v_review_count,
    'review_avg', ROUND(v_review_avg, 1)
  );
END;
$$ LANGUAGE plpgsql;
