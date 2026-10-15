import { supabase } from './supabase';
import { createNotification } from './notifications';

export type ReportContext = 'match' | 'chat' | 'partner';

export const REPORT_REASONS = [
  '불쾌한 말이나 행동',
  '사진·프로필이 본인과 달라요',
  '금전 요구·영업·포교',
  '약속을 지키지 않아요',
  '기타',
];

export async function reportUser(reporterId: string, targetId: string, context: ReportContext, reason: string, detail: string) {
  const { data, error } = await supabase.rpc('fn_report_user', {
    p_reporter_id: reporterId,
    p_target_id: targetId,
    p_context: context,
    p_reason: reason,
    p_detail: detail,
  });
  return !error && !!data?.ok;
}

export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase.from('user_blocks').insert([{ blocker_id: blockerId, blocked_id: blockedId }]);
  const ok = !error || error.code === '23505'; // 이미 차단한 상대
  if (ok) await closeMatchesBetween(blockerId, blockedId).catch((e) => console.error('close on block error:', e));
  return ok;
}

// 차단하면 두 사람 사이의 만남 전 매칭을 끝낸다. 파트너와 상대에게는 차단 사실을 밝히지 않는다
async function closeMatchesBetween(a: string, b: string) {
  const { data } = await supabase
    .from('match_requests')
    .select('id, hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id, connector_1_consented, connector_2_consented, status, settlement_completed, meeting_status')
    .in('hopeful_1_id', [a, b])
    .in('hopeful_2_id', [a, b]);
  const open = (data || []).filter((m: any) => m.status !== 'rejected' && !m.settlement_completed && m.meeting_status !== 'completed');
  for (const m of open) {
    const { data: closed } = await supabase.from('match_requests').update({ status: 'rejected' }).eq('id', m.id).neq('status', 'rejected').select('id');
    if (!closed?.length) continue;
    const connectors = [...new Set<string>([m.connector_1_id, m.connector_2_id].filter(Boolean))];
    await Promise.all([
      ...connectors.map((id) => createNotification({ userId: id, type: 'match_closed', title: '매칭이 종료되었어요', body: '회원 사정으로 이번 매칭이 진행되지 않게 되었어요', route: '/matching' })),
      // 상대 회원에게는 제안이 전달된 경우(동맹 매칭은 두 파트너 동의 후)만 알린다
      ...(m.connector_1_id === m.connector_2_id || (m.connector_1_consented && m.connector_2_consented)
        ? [createNotification({ userId: b, type: 'match_closed', title: '이번 소개는 진행되지 않게 되었어요', body: '이용권은 차감되지 않았어요', route: '/home' })]
        : []),
    ]);
  }
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId);
  return !error;
}

// 내가 차단한 사람 목록 (마이 › 차단 목록)
export async function fetchMyBlocks(userId: string): Promise<{ id: string; name: string; created_at: string }[]> {
  const { data } = await supabase.from('user_blocks').select('blocked_id, created_at').eq('blocker_id', userId).order('created_at', { ascending: false });
  const ids = (data || []).map((b: any) => b.blocked_id);
  if (!ids.length) return [];
  const { data: users } = await supabase.from('users').select('id, name').in('id', ids);
  return (data || []).map((b: any) => ({
    id: b.blocked_id,
    name: (users || []).find((u: any) => u.id === b.blocked_id)?.name || '회원',
    created_at: b.created_at,
  }));
}

// 두 사람 사이 차단 상태: 내가 막았는지 / 상대가 나를 막았는지
export async function getBlockState(me: string, other: string) {
  const { data } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .in('blocker_id', [me, other])
    .in('blocked_id', [me, other]);
  return {
    iBlocked: (data || []).some((b: any) => b.blocker_id === me),
    blockedMe: (data || []).some((b: any) => b.blocker_id === other),
  };
}

// 운영자가 회원이나 파트너를 이용 정지하면 만나기 전 소개를 모두 끝낸다
// (정지된 사람은 로그인해 답하거나 만남 완료를 누를 수 없어 소개가 멈춰 버리므로)
// 남은 사람들에게 알린다: 회원은 제안이 전달된 경우만. 정지 사실은 밝히지 않는다
export async function closeOpenMatchesOf(userId: string) {
  const cols = 'id, hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id, connector_1_consented, connector_2_consented, status, settlement_completed, meeting_status';
  const results = await Promise.all(
    ['hopeful_1_id', 'hopeful_2_id', 'connector_1_id', 'connector_2_id'].map((col) => supabase.from('match_requests').select(cols).eq(col, userId))
  );
  const seen = new Set<string>();
  const open = results.flatMap((r) => r.data || []).filter((m: any) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return m.status !== 'rejected' && !m.settlement_completed && m.meeting_status !== 'completed';
  });
  let closedCount = 0;
  for (const m of open as any[]) {
    const { data: closed } = await supabase.from('match_requests').update({ status: 'rejected', closed_reason: 'cancelled' }).eq('id', m.id).neq('status', 'rejected').select('id');
    if (!closed?.length) continue;
    closedCount++;
    const asMember = m.hopeful_1_id === userId || m.hopeful_2_id === userId;
    const delivered = m.connector_1_id === m.connector_2_id || (m.connector_1_consented && m.connector_2_consented);
    const members = [m.hopeful_1_id, m.hopeful_2_id].filter((id: string) => id && id !== userId);
    const connectors = [...new Set<string>([m.connector_1_id, m.connector_2_id].filter((id: string) => id && id !== userId))];
    await Promise.all([
      ...connectors.map((id) => createNotification({ userId: id, type: 'match_closed', title: '매칭이 종료되었어요', body: asMember ? '회원 사정으로 이번 매칭이 진행되지 않게 되었어요' : '상대 파트너 사정으로 이번 매칭이 진행되지 않게 되었어요', route: '/matching' })),
      ...(delivered ? members.map((id: string) => createNotification({ userId: id, type: 'match_closed', title: '이번 소개는 진행되지 않게 되었어요', body: asMember ? '상대 사정으로 종료되었어요. 이용권은 차감되지 않았어요' : '파트너 사정으로 종료되었어요. 이용권은 차감되지 않았어요', route: '/home' })) : []),
    ]);
  }
  return closedCount;
}

// 회원이 파트너와의 가입을 해지한다 (차단과 함께). 그 파트너를 통한 진행 중인 소개가 있으면 해지하지 않는다
export async function leavePartner(hopefulId: string, connectorId: string) {
  const cols = 'id, status, settlement_completed, connector_1_id, connector_2_id';
  const [{ data: m1 }, { data: m2 }] = await Promise.all([
    supabase.from('match_requests').select(cols).eq('hopeful_1_id', hopefulId).eq('connector_1_id', connectorId),
    supabase.from('match_requests').select(cols).eq('hopeful_2_id', hopefulId).eq('connector_2_id', connectorId),
  ]);
  if ([...(m1 || []), ...(m2 || [])].some((m: any) => m.status !== 'rejected' && !m.settlement_completed)) return false;
  const { error } = await supabase.from('hopeful_requests').delete().eq('hopeful_id', hopefulId).eq('connector_id', connectorId).in('status', ['approved', 'pending']);
  return !error;
}
