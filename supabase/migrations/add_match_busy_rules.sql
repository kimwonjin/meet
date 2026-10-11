-- 매칭 제안 규칙을 서버에서도 지킨다 (지금까지는 앱 화면에서만 막았다)
-- 1) 진행 중인 매칭이 있는 회원은 새 매칭에 넣을 수 없다 (만남중)
-- 2) 같은 성별끼리는 매칭할 수 없다
-- 동맹 파트너가 동의할 때(fn_consent_match)도 1)을 다시 확인한다.
-- 데이터를 바꾸지 않고 함수만 바꾼다. 실행 전에도 앱은 그대로 동작한다.

CREATE OR REPLACE FUNCTION fn_member_busy(p_hopeful_id UUID, p_except_match UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_requests
    WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
      AND (hopeful_1_id = p_hopeful_id OR hopeful_2_id = p_hopeful_id)
      AND (p_except_match IS NULL OR id != p_except_match)
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_propose_match(p_proposer_id UUID, p_hopeful_1 UUID, p_connector_1 UUID, p_hopeful_2 UUID, p_connector_2 UUID)
RETURNS JSON AS $$
DECLARE
  v_id UUID;
  v_internal BOOLEAN := p_connector_1 = p_connector_2;
  v_g1 TEXT;
  v_g2 TEXT;
BEGIN
  IF p_hopeful_1 = p_hopeful_2 THEN
    RETURN json_build_object('ok', false, 'reason', 'same_member');
  END IF;
  -- 제안하는 파트너의 회원이 반드시 한 명 이상 포함되어야 한다
  IF p_proposer_id NOT IN (p_connector_1, p_connector_2) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_your_member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE hopeful_id = p_hopeful_1 AND connector_id = p_connector_1 AND status = 'approved')
     OR NOT EXISTS (SELECT 1 FROM hopeful_requests WHERE hopeful_id = p_hopeful_2 AND connector_id = p_connector_2 AND status = 'approved') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_member');
  END IF;
  IF NOT v_internal AND NOT EXISTS (
    SELECT 1 FROM connector_alliances
    WHERE status = 'ACTIVE'
      AND ((connector_1_id = p_connector_1 AND connector_2_id = p_connector_2) OR (connector_1_id = p_connector_2 AND connector_2_id = p_connector_1))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'no_alliance');
  END IF;

  SELECT gender INTO v_g1 FROM users WHERE id = p_hopeful_1;
  SELECT gender INTO v_g2 FROM users WHERE id = p_hopeful_2;
  IF v_g1 IS NOT NULL AND v_g1 = v_g2 THEN
    RETURN json_build_object('ok', false, 'reason', 'same_gender');
  END IF;

  -- 두 회원을 같은 순서로 잠가 교착을 피한다 (동시에 들어온 제안도 한 건만 통과)
  PERFORM fn_lock_user(LEAST(p_hopeful_1, p_hopeful_2));
  PERFORM fn_lock_user(GREATEST(p_hopeful_1, p_hopeful_2));

  IF EXISTS (
    SELECT 1 FROM match_requests
    WHERE status != 'rejected' AND settlement_completed IS NOT TRUE
      AND ((hopeful_1_id = p_hopeful_1 AND hopeful_2_id = p_hopeful_2) OR (hopeful_1_id = p_hopeful_2 AND hopeful_2_id = p_hopeful_1))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'duplicate');
  END IF;

  IF fn_member_busy(p_hopeful_1) THEN
    RETURN json_build_object('ok', false, 'reason', 'busy', 'hopeful_id', p_hopeful_1);
  END IF;
  IF fn_member_busy(p_hopeful_2) THEN
    RETURN json_build_object('ok', false, 'reason', 'busy', 'hopeful_id', p_hopeful_2);
  END IF;

  IF fn_available_credit(p_hopeful_1, p_connector_1) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', p_hopeful_1);
  END IF;
  IF fn_available_credit(p_hopeful_2, p_connector_2) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', p_hopeful_2);
  END IF;

  INSERT INTO match_requests (hopeful_1_id, connector_1_id, hopeful_2_id, connector_2_id, status, proposer_connector_id, connector_1_consented, connector_2_consented)
  VALUES (p_hopeful_1, p_connector_1, p_hopeful_2, p_connector_2, 'pending', p_proposer_id,
          v_internal OR p_connector_1 = p_proposer_id, v_internal OR p_connector_2 = p_proposer_id)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'needs_consent', NOT v_internal);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_consent_match(p_match_id UUID, p_connector_id UUID)
RETURNS JSON AS $$
DECLARE
  m match_requests%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match_requests WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND OR m.status = 'rejected' OR m.settlement_completed THEN
    RETURN json_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF NOT ((m.connector_1_id = p_connector_id AND NOT m.connector_1_consented)
       OR (m.connector_2_id = p_connector_id AND NOT m.connector_2_consented)) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_needed');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM connector_alliances
    WHERE status = 'ACTIVE'
      AND ((connector_1_id = m.connector_1_id AND connector_2_id = m.connector_2_id) OR (connector_1_id = m.connector_2_id AND connector_2_id = m.connector_1_id))
  ) THEN
    RETURN json_build_object('ok', false, 'reason', 'no_alliance');
  END IF;

  PERFORM fn_lock_user(LEAST(m.hopeful_1_id, m.hopeful_2_id));
  PERFORM fn_lock_user(GREATEST(m.hopeful_1_id, m.hopeful_2_id));
  -- 동의를 기다리는 사이 두 회원 중 누가 다른 매칭에 들어갔으면 동의할 수 없다
  IF fn_member_busy(m.hopeful_1_id, p_match_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'busy', 'hopeful_id', m.hopeful_1_id);
  END IF;
  IF fn_member_busy(m.hopeful_2_id, p_match_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'busy', 'hopeful_id', m.hopeful_2_id);
  END IF;
  IF fn_available_credit(m.hopeful_1_id, m.connector_1_id) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', m.hopeful_1_id);
  END IF;
  IF fn_available_credit(m.hopeful_2_id, m.connector_2_id) <= 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no_credit', 'hopeful_id', m.hopeful_2_id);
  END IF;

  UPDATE match_requests SET
    connector_1_consented = connector_1_consented OR connector_1_id = p_connector_id,
    connector_2_consented = connector_2_consented OR connector_2_id = p_connector_id
  WHERE id = p_match_id;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;
