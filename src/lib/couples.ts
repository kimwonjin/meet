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
  const { error } = await supabase.from('match_requests').update({ couple_at: on ? new Date().toISOString() : null }).eq('id', match.id);
  if (error) return false;
  if (on) {
    // 두 회원에게 축하 + 새 소개를 쉬는 방법 안내 (쉬기를 억지로 켜지는 않는다)
    await Promise.all([match.hopeful_1_id, match.hopeful_2_id].map((uid) => createNotification({
      userId: uid, type: 'couple_marked', title: '커플이 되신 걸 축하해요 💞',
      body: '새 소개를 잠시 멈추고 싶으면 마이 › 소개 잠시 쉬기를 켜 주세요', route: '/profile',
    }).catch(() => {})));
  }
  return true;
}
