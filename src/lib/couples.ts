// 커플 성사: 두 회원이 모두 다시 만나고 싶어한 매칭을 파트너가 표시한다 (add_couples.sql 전이면 null)
import { supabase } from './supabase';
import { createNotification } from './notifications';

// 이 파트너가 맡은(내 회원 쪽이든 동맹 쪽이든) 커플 성사 수
export async function fetchCoupleCount(connectorId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('match_requests')
    .select('id', { count: 'exact', head: true })
    .not('couple_at', 'is', null)
    .or(`connector_1_id.eq.${connectorId},connector_2_id.eq.${connectorId}`);
  if (error) return null;
  return count || 0;
}

export async function setCouple(match: { id: string; hopeful_1_id: string; hopeful_2_id: string }, on: boolean) {
  if (!on) {
    const { error } = await supabase.from('match_requests').update({ couple_at: null }).eq('id', match.id);
    return !error;
  }
  // 비어 있을 때만 표시한다 (동맹 파트너 둘이 거의 동시에 눌러도 한 번만)
  const { data, error } = await supabase.from('match_requests').update({ couple_at: new Date().toISOString() }).eq('id', match.id).is('couple_at', null).select('id');
  if (error) return false;
  if (!data?.length) return true;
  // 두 회원에게 축하 + 새 소개를 쉬는 방법 안내 (쉬기를 억지로 켜지는 않는다)
  // 표시를 취소했다가 다시 눌러도 축하 알림은 한 번만 간다
  const { data: sent } = await supabase.from('notifications').select('user_id')
    .in('user_id', [match.hopeful_1_id, match.hopeful_2_id]).eq('type', 'couple_marked');
  const already = new Set(((sent || []) as any[]).map((n) => n.user_id as string));
  await Promise.all([match.hopeful_1_id, match.hopeful_2_id].filter((uid) => !already.has(uid)).map((uid) => createNotification({
    userId: uid, type: 'couple_marked', title: '커플이 되신 걸 축하해요 💞',
    body: '새 소개를 잠시 멈추고 싶으면 마이 › 소개 잠시 쉬기를 켜 주세요', route: '/profile',
  }).catch(() => {})));
  return true;
}
