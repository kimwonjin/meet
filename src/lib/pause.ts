// 회원 '잠시 쉬기': 쉬는 동안은 파트너가 새 소개를 제안할 수 없다 (진행 중인 소개는 그대로)
// SQL(add_pause_and_preferences.sql) 실행 전에는 available=false → 화면에서 숨긴다
import { supabase } from './supabase';
import { createNotification } from './notifications';

export async function getPauseState(userId: string): Promise<{ available: boolean; pausedAt: string | null }> {
  const { data, error } = await supabase.from('users').select('paused_at').eq('id', userId).maybeSingle();
  if (error) return { available: false, pausedAt: null };
  return { available: true, pausedAt: (data as any)?.paused_at ?? null };
}

// 쉬는 중인 회원 (목록 표시·매칭 후보에서 막기)
export async function fetchPausedIds(ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Set();
  const { data, error } = await supabase.from('users').select('id').in('id', list).not('paused_at', 'is', null);
  if (error) return new Set();
  return new Set((data || []).map((r: any) => r.id as string));
}

// 쉬기 켜기·끄기. 내 파트너들에게도 알린다 (누구에게 소개하지 말아야 하는지 알 수 있게)
export async function setPaused(user: { id: string; name: string }, on: boolean) {
  const at = on ? new Date().toISOString() : null;
  const { error } = await supabase.from('users').update({ paused_at: at }).eq('id', user.id);
  if (error) return { ok: false as const };
  const { data: reqs } = await supabase.from('hopeful_requests').select('connector_id').eq('hopeful_id', user.id).eq('status', 'approved');
  const partners = [...new Set(((reqs || []) as any[]).map((r) => r.connector_id as string))];
  await Promise.all(partners.map((id) => createNotification({
    userId: id,
    type: on ? 'member_paused' : 'member_resumed',
    title: on ? `${user.name}님이 소개를 잠시 쉬어요` : `${user.name}님이 다시 소개받기를 시작했어요`,
    body: on ? "쉬는 동안은 매칭 후보에서 '쉬는 중'으로 보여요. 진행 중인 소개는 그대로예요" : '이제 다시 매칭을 제안할 수 있어요',
    route: '/connectors',
  }).catch(() => {})));
  return { ok: true as const, at };
}
