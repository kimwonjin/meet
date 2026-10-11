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
    .select('id, hopeful_1_id, hopeful_2_id, connector_1_id, connector_2_id, status, settlement_completed, meeting_status')
    .in('hopeful_1_id', [a, b])
    .in('hopeful_2_id', [a, b]);
  const open = (data || []).filter((m: any) => m.status !== 'rejected' && !m.settlement_completed && m.meeting_status !== 'completed');
  for (const m of open) {
    const { data: closed } = await supabase.from('match_requests').update({ status: 'rejected' }).eq('id', m.id).neq('status', 'rejected').select('id');
    if (!closed?.length) continue;
    const connectors = [...new Set<string>([m.connector_1_id, m.connector_2_id].filter(Boolean))];
    await Promise.all([
      ...connectors.map((id) => createNotification({ userId: id, type: 'match_closed', title: '매칭이 종료되었어요', body: '회원 사정으로 이번 매칭이 진행되지 않게 되었어요', route: '/matching' })),
      createNotification({ userId: b, type: 'match_closed', title: '이번 소개는 진행되지 않게 되었어요', body: '이용권은 차감되지 않았어요', route: '/home' }),
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
