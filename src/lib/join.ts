import { supabase } from './supabase';
import { createNotification } from './notifications';

export type JoinState = 'none' | 'pending' | 'approved';

// 회원 ↔ 파트너 가입 상태 (가장 최근 요청 기준, 거절됐으면 다시 신청 가능)
export async function getJoinState(hopefulId: string, connectorId: string): Promise<JoinState> {
  const { data } = await supabase
    .from('hopeful_requests')
    .select('status')
    .eq('hopeful_id', hopefulId)
    .eq('connector_id', connectorId)
    .order('created_at', { ascending: false })
    .limit(1);
  const s = data?.[0]?.status;
  return s === 'approved' ? 'approved' : s === 'pending' ? 'pending' : 'none';
}

// 파트너에게 가입 신청을 보낸다. 초대 링크로 왔으면 어떤 링크였는지 함께 남긴다.
export async function requestJoin(
  me: { id: string; name: string },
  connectorId: string,
  inviteCode?: string | null
): Promise<'sent' | 'pending' | 'approved' | 'error' | 'unavailable'> {
  const state = await getJoinState(me.id, connectorId);
  if (state !== 'none') return state;
  // 초대장을 연 뒤 가입하는 사이에 파트너가 탈퇴·정지했거나 활동을 쉬고 있으면 신청하지 않는다
  const [{ data: conn }, { data: pu }] = await Promise.all([
    supabase.from('connectors').select('status').eq('id', connectorId).maybeSingle(),
    supabase.from('users').select('role, withdrawn_at, suspended_at').eq('id', connectorId).maybeSingle(),
  ]);
  if (conn?.status !== 'approved' || !pu || pu.withdrawn_at || pu.suspended_at || pu.role !== 'connector') return 'unavailable';
  const row: Record<string, any> = {
    hopeful_id: me.id,
    connector_id: connectorId,
    status: 'pending',
    message: `${me.name}님이 가입을 요청했습니다.`,
  };
  let { error } = await supabase.from('hopeful_requests').insert([inviteCode ? { ...row, invite_code: inviteCode } : row]);
  // 링크 기록 칸이 아직 없으면(DB 준비 전) 기록 없이 신청한다
  if (error && inviteCode && (error.code === '42703' || error.code === 'PGRST204')) {
    ({ error } = await supabase.from('hopeful_requests').insert([row]));
  }
  if (error) return 'error';
  await createNotification({
    userId: connectorId,
    type: 'signup_request',
    title: '새로운 가입 신청이 있습니다',
    body: `${me.name}님이 가입을 요청했습니다`,
    route: '/connectors',
  });
  return 'sent';
}
