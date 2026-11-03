import { supabase } from './supabase';
import { createNotification } from './notifications';

// 동맹 요청 한마디는 채팅에 이 머리말로 남는다
export const ALLIANCE_NOTE_PREFIX = '🤝 동맹 요청\n';
// 수락하면 채팅방에 남기는 안내 줄 (본인 말풍선이 아니라 가운데 안내로 보인다)
export const ALLIANCE_DONE_NOTICE = '🤝 동맹을 맺었어요. 이제 서로의 회원을 소개할 수 있어요';
// 회원이 가입 신청을 하면 그 파트너와의 채팅방에 남기는 안내 줄
export const joinRequestNotice = (name: string) => `🙋 ${name}님이 가입을 신청했어요`;
export const JOIN_APPROVED_NOTICE = '✓ 가입이 승인됐어요. 이제 이 파트너에게 소개받을 수 있어요';
export const isChatNotice = (content?: string | null) =>
  content === ALLIANCE_DONE_NOTICE || content === JOIN_APPROVED_NOTICE || (!!content && content.startsWith('🙋 ') && content.endsWith('님이 가입을 신청했어요') && !content.includes('\n'));

// 상대(otherId)가 나(meId)에게 보낸, 아직 답하지 않은 동맹 요청
export async function findIncomingRequest(meId: string, otherId: string): Promise<any | null> {
  const { data } = await supabase
    .from('connector_alliances')
    .select('*')
    .eq('status', 'PENDING')
    .eq('requested_by', otherId)
    .or(`and(connector_1_id.eq.${otherId},connector_2_id.eq.${meId}),and(connector_1_id.eq.${meId},connector_2_id.eq.${otherId})`)
    .limit(1);
  return data?.[0] ?? null;
}

// 동맹 수락: 'ok' 수락됨, 'gone' 상대가 취소했거나 이미 처리됨. 실패하면 throw
export async function acceptAlliance(alliance: { id: string; requested_by?: string | null }, myName?: string | null): Promise<'ok' | 'gone'> {
  const { data: accepted, error } = await supabase
    .from('connector_alliances')
    .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
    .eq('id', alliance.id)
    .eq('status', 'PENDING')
    .select('id');
  if (error) throw error;
  if (!accepted?.length) return 'gone';
  if (alliance.requested_by) {
    await createNotification({
      userId: alliance.requested_by,
      type: 'alliance_accepted',
      title: '동맹 요청이 수락되었습니다',
      body: `${myName ?? ''}님이 동맹 요청을 수락했어요. 이제 동맹 회원을 볼 수 있어요`,
      route: '/connectors',
      routeParams: { tab: 'ally' },
    });
  }
  return 'ok';
}

// 상대가 동맹 요청과 함께 보낸 한마디 (채팅에 남은 가장 최근 것, 없으면 null)
export async function fetchRequestNote(meId: string, otherId: string): Promise<string | null> {
  const { data: threads } = await supabase
    .from('chat_threads')
    .select('id')
    .or(`and(participant_1_id.eq.${otherId},participant_2_id.eq.${meId}),and(participant_1_id.eq.${meId},participant_2_id.eq.${otherId})`)
    .limit(1);
  const threadId = threads?.[0]?.id;
  if (!threadId) return null;
  const { data } = await supabase
    .from('chat_messages')
    .select('content')
    .eq('thread_id', threadId)
    .eq('sender_id', otherId)
    .like('content', `${ALLIANCE_NOTE_PREFIX}%`)
    .order('created_at', { ascending: false })
    .limit(1);
  const c = data?.[0]?.content as string | undefined;
  return c ? c.slice(ALLIANCE_NOTE_PREFIX.length).trim() || null : null;
}

// 동맹 파트너의 회원 수 (탈퇴·정지 회원 제외). 모르면 null
export async function countAllyMembers(connectorId: string): Promise<number | null> {
  const { data, error } = await supabase.from('hopeful_requests').select('hopeful_id').eq('connector_id', connectorId).eq('status', 'approved');
  if (error) return null;
  const ids = [...new Set((data || []).map((r: any) => r.hopeful_id))];
  if (!ids.length) return 0;
  const { data: gone } = await supabase.from('users').select('id').in('id', ids).or('withdrawn_at.not.is.null,suspended_at.not.is.null');
  return ids.length - (gone || []).length;
}
