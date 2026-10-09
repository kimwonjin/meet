// 진행 중인 매칭의 단계 (홈 묶음 · 매칭내역 걸러 보기에서 같이 쓴다)
export type MatchStage = 'consent' | 'member' | 'date' | 'meeting' | 'after';

export const STAGE_LABEL: Record<MatchStage, string> = {
  consent: '파트너 동의 대기',
  member: '회원 응답 대기',
  date: '날짜 조율',
  meeting: '만남 예정',
  after: '애프터·마무리',
};

export const STAGE_ORDER: MatchStage[] = ['consent', 'member', 'date', 'meeting', 'after'];

export function matchStage(m: any): MatchStage {
  const cross = m.connector_1_id !== m.connector_2_id;
  if (cross && !(m.connector_1_consented && m.connector_2_consented)) return 'consent';
  if (!(m.hopeful_1_approved && m.hopeful_2_approved)) return 'member';
  if (!m.meeting_scheduled_at) return 'date';
  if (m.meeting_status !== 'completed') return 'meeting';
  return 'after';
}

// 이 매칭의 일정·진행을 맡은 파트너 (동맹 매칭은 제안한 파트너)
export function schedulerOf(m: any) {
  return m.connector_1_id !== m.connector_2_id ? m.proposer_connector_id || m.connector_1_id : m.connector_1_id;
}

export function needsMyConsent(m: any, me?: string) {
  return (
    m.connector_1_id !== m.connector_2_id &&
    ((m.connector_1_id === me && !m.connector_1_consented) || (m.connector_2_id === me && !m.connector_2_consented))
  );
}
