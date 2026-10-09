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

// 매칭내역 걸러 보기: 단계 + 홈에서 쓰는 두 가지 묶음
export type MatchFilter = MatchStage | 'overdue' | 'waiting';

export const FILTER_LABEL: Record<MatchFilter, string> = {
  ...STAGE_LABEL,
  overdue: '지난 만남 완료 처리',
  waiting: '답을 기다리는 매칭',
};

export const FILTERS = [...STAGE_ORDER, 'overdue', 'waiting'] as MatchFilter[];

// 만남 날짜가 지났는데 내가 아직 '만남 완료'를 누르지 않은 매칭
export function isOverdueForMe(m: any, me?: string, now = new Date()) {
  if (!m.meeting_scheduled_at || m.meeting_status === 'completed') return false;
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  if (new Date(m.meeting_scheduled_at) >= startOfToday) return false;
  const mineDone = (m.connector_1_id === me && m.meeting_done_connector_1) || (m.connector_2_id === me && m.meeting_done_connector_2);
  return !mineDone;
}

// 상대(회원·다른 파트너)가 답해야 다음으로 넘어가는 매칭 (내 차례인 것은 제외)
export function isWaitingOnOthers(m: any, me?: string) {
  const st = matchStage(m);
  if (st === 'consent') return !needsMyConsent(m, me);
  if (st === 'member') return true;
  if (st === 'date') return schedulerOf(m) !== me;
  return false;
}

export function passesFilter(m: any, f: MatchFilter, me?: string) {
  if (f === 'overdue') return isOverdueForMe(m, me);
  if (f === 'waiting') return isWaitingOnOthers(m, me);
  return matchStage(m) === f;
}
