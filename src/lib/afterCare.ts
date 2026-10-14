import { supabase } from './supabase';
import { createNotification } from './notifications';

// 만남 완료 후 이 기간 안에 애프터 의사를 고르지 않으면 '미신청'으로 처리하고 정산한다
export const AFTER_CARE_DAYS = 7;

export function afterCareDeadline(meetingCompletedAt: string) {
  const d = new Date(meetingCompletedAt);
  d.setDate(d.getDate() + AFTER_CARE_DAYS);
  return d;
}

export function formatDeadline(d: Date) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

type AfterCareMatch = {
  id: string;
  status?: string;
  meeting_status?: string;
  meeting_completed_at?: string | null;
  meeting_scheduled_at?: string | null;
  settlement_completed?: boolean;
  after_care_hopeful_1?: string | null;
  after_care_hopeful_2?: string | null;
};

// 기한이 지난 매칭은 응답하지 않은 쪽을 '미신청'으로 채우고 정산한다.
// 별도 서버 작업 없이, 회원이나 파트너가 화면을 열 때 처리된다. 처리한 경우 true.
export async function expireAfterCareIfDue(m: AfterCareMatch) {
  // 취소된 매칭은 마무리(정산)하지 않는다
  if (m.status === 'rejected' || m.meeting_status !== 'completed' || m.settlement_completed) return false;
  // 노쇼 신고는 파트너가 확인할 때까지 자동으로 마무리하지 않는다
  if (m.after_care_hopeful_1 === '노쇼신고' || m.after_care_hopeful_2 === '노쇼신고') return false;

  // 두 회원이 모두 골랐는데 마무리가 안 된 경우 (네트워크 오류 등) 다시 시도한다
  if (m.after_care_hopeful_1 && m.after_care_hopeful_2) {
    const { data: settledNow, error } = await supabase.rpc('fn_settle_match', { p_match_id: m.id });
    if (error) {
      console.error('after-care settle retry error:', error);
      return false;
    }
    if (settledNow) await notifyAfterCareResult(m.id);
    return !!settledNow;
  }

  // 만남 완료 시각이 없는 예전 매칭은 만남 날짜를 기준으로 계산한다
  const base = m.meeting_completed_at || m.meeting_scheduled_at;
  if (!base) return false;
  if (Date.now() < afterCareDeadline(base).getTime()) return false;

  // 답하지 않은 쪽은 '미신청'으로 채우고, 자동으로 채웠다는 표시를 따로 남긴다 (표시 칸이 없으면 조용히 넘어간다)
  if (!m.after_care_hopeful_1) {
    const { data: f1 } = await supabase.from('match_requests').update({ after_care_hopeful_1: '미신청' }).eq('id', m.id).is('after_care_hopeful_1', null).select('id');
    if (f1?.length) await supabase.from('match_requests').update({ after_care_auto_1: true }).eq('id', m.id);
  }
  if (!m.after_care_hopeful_2) {
    const { data: f2 } = await supabase.from('match_requests').update({ after_care_hopeful_2: '미신청' }).eq('id', m.id).is('after_care_hopeful_2', null).select('id');
    if (f2?.length) await supabase.from('match_requests').update({ after_care_auto_2: true }).eq('id', m.id);
  }
  // 여러 화면이 동시에 처리해도 실제로 마무리한 한 곳만 결과를 알린다
  const { data: settledNow, error } = await supabase.rpc('fn_settle_match', { p_match_id: m.id });
  if (error) console.error('after-care auto close error:', error);
  else if (settledNow) await notifyAfterCareResult(m.id);
  return true;
}

// 두 회원의 애프터 의사가 모두 모인 뒤에만 결과를 알린다 (먼저 고른 사람이 상대 선택을 보고 정하지 못하게).
// 회원에게는 '둘 다 원함' 또는 '마무리'만 알리고, 누가 원하지 않았는지는 알리지 않는다.
// exceptUserId: 방금 화면에서 결과를 확인한 회원 (알림 생략)
// 파트너에게 보여주는 애프터 결과: 둘 다 / 남성만 / 여성만 / 둘 다 마무리
// (회원에게는 누가 원하지 않았는지 알리지 않지만, 주선자는 다음 소개를 위해 알아야 한다)
// auto1·auto2: 기한 안에 답하지 않아 자동으로 마무리된 쪽 (직접 '이번이 마지막이에요'를 고른 것과 구분)
export function afterCareOutcome(a1?: string | null, a2?: string | null, g1?: string | null, g2?: string | null, auto1?: boolean, auto2?: boolean) {
  const w1 = a1 === '신청', w2 = a2 === '신청';
  const who = (g?: string | null) => (g === 'M' ? '남성' : g === 'F' ? '여성' : '한 분');
  if (w1 && w2) return { mutual: true, label: '💞 두 회원 모두 다시 만나고 싶어해요' };
  if (!w1 && !w2) {
    if (auto1 && auto2) return { mutual: false, label: '두 회원 모두 기한 안에 답하지 않았어요' };
    if (auto1 || auto2) return { mutual: false, label: `${who(auto1 ? g2 : g1)}은 마무리, ${who(auto1 ? g1 : g2)}은 답하지 않았어요` };
    return { mutual: false, label: '두 회원 모두 이번 만남으로 마무리했어요' };
  }
  const otherAuto = w1 ? auto2 : auto1;
  const base = `${who(w1 ? g1 : g2)}만 다시 만나고 싶어해요`;
  return { mutual: false, label: otherAuto ? `${base} · ${who(w1 ? g2 : g1)}은 답하지 않았어요` : base };
}

export async function notifyAfterCareResult(matchId: string, exceptUserId?: string) {
  const { data: m } = await supabase.from('match_requests').select('*').eq('id', matchId).single();
  if (!m || !m.after_care_hopeful_1 || !m.after_care_hopeful_2 || m.closed_reason === 'no_show') return;
  const mutual = m.after_care_hopeful_1 === '신청' && m.after_care_hopeful_2 === '신청';
  const { data: people } = await supabase.from('users').select('id, name, gender').in('id', [m.hopeful_1_id, m.hopeful_2_id]);
  const g = Object.fromEntries((people || []).map((u: any) => [u.id, u.gender]));
  const names: Record<string, string> = Object.fromEntries((people || []).map((u: any) => [u.id, u.name]));
  const outcome = afterCareOutcome(m.after_care_hopeful_1, m.after_care_hopeful_2, g[m.hopeful_1_id], g[m.hopeful_2_id], !!m.after_care_auto_1, !!m.after_care_auto_2);

  const members = [m.hopeful_1_id, m.hopeful_2_id].filter((id: string) => id !== exceptUserId);
  const connectors = [...new Set<string>([m.connector_1_id, m.connector_2_id])];
  await Promise.all([
    ...members.map((id: string) => createNotification({
      userId: id,
      type: 'after_care_result',
      title: mutual ? '💞 상대도 다시 만나고 싶어해요' : '소개팅 결과가 도착했어요',
      body: mutual ? '채팅에서 받은 연락처로 다시 연락해보세요' : '이번 만남은 여기서 마무리되었어요',
      route: '/home',
    })),
    ...connectors.map((id) => createNotification({
      userId: id,
      type: mutual ? 'after_care_mutual' : 'after_care_result',
      title: outcome.label,
      body: `${names[m.hopeful_1_id] || '회원'} ↔ ${names[m.hopeful_2_id] || '회원'} 소개팅 결과예요`,
      route: '/matching',
      routeParams: connectors.length > 1 ? { segment: 'ally' } : undefined,
    })),
  ]);
}

// 답이 없는 제안: 회원 승인이나 (동맹 매칭의) 파트너 동의가 이 기간 동안 없으면 자동으로 종료한다
export const PROPOSAL_EXPIRE_DAYS = 7;

type ProposalMatch = {
  id: string;
  status?: string;
  created_at?: string;
  settlement_completed?: boolean;
  hopeful_1_id?: string; hopeful_2_id?: string;
  connector_1_id?: string; connector_2_id?: string;
  connector_1_consented?: boolean; connector_2_consented?: boolean;
  hopeful_1_approved?: boolean; hopeful_2_approved?: boolean;
  consented_at?: string | null;
};

// 답이 없으면 자동 종료되는 날 (화면 안내에도 같은 계산을 쓴다)
export function proposalDeadline(m: ProposalMatch) {
  const consentDone = m.connector_1_id === m.connector_2_id || (m.connector_1_consented && m.connector_2_consented);
  // 동맹 매칭은 두 파트너 동의가 끝난 뒤에야 회원에게 전달되므로, 그때부터 다시 센다 (consented_at 칸이 없으면 만든 날 기준)
  const start = consentDone && m.consented_at && m.created_at && m.consented_at > m.created_at ? m.consented_at : m.created_at!;
  const due = new Date(start);
  due.setDate(due.getDate() + PROPOSAL_EXPIRE_DAYS);
  return due;
}

// 별도 서버 작업 없이 화면을 열 때 처리한다. 실제로 종료한 경우 true (여러 화면이 동시에 해도 한 번만 알린다)
export async function expireStaleProposalIfDue(m: ProposalMatch) {
  if (m.status === 'rejected' || m.settlement_completed || !m.created_at) return false;
  const consentDone = m.connector_1_id === m.connector_2_id || (m.connector_1_consented && m.connector_2_consented);
  const membersDone = m.hopeful_1_approved && m.hopeful_2_approved;
  if (consentDone && membersDone) return false;
  if (Date.now() < proposalDeadline(m).getTime()) return false;

  const { data: closed } = await supabase
    .from('match_requests')
    .update({ status: 'rejected', closed_reason: 'expired' })
    .eq('id', m.id)
    .neq('status', 'rejected')
    .eq('settlement_completed', false)
    .select('id');
  if (!closed?.length) return false;

  const connectors = [...new Set([m.connector_1_id, m.connector_2_id].filter(Boolean) as string[])];
  await Promise.all([
    ...connectors.map((id) => createNotification({
      userId: id, type: 'match_expired', title: '답이 없어 매칭이 자동 종료되었어요',
      body: `${PROPOSAL_EXPIRE_DAYS}일 동안 승인·동의가 없었어요. 이용권은 차감되지 않았어요`, route: '/matching',
    }).catch(() => {})),
    // 회원에게는 제안이 전달된 경우(파트너 동의가 끝난 경우)만 알린다
    ...(consentDone ? [m.hopeful_1_id, m.hopeful_2_id].filter(Boolean).map((id) => createNotification({
      userId: id as string, type: 'match_closed', title: '이번 소개는 진행되지 않게 되었어요',
      body: '답이 없어 자동으로 종료되었어요. 이용권은 차감되지 않았어요', route: '/home',
    }).catch(() => {})) : []),
  ]);
  return true;
}
