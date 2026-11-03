import { supabase } from './supabase';

// 원하는 만남: 처음 프로필 채우기에서 가볍게 묻고, 파트너가 소개할 사람을 고를 때 본다 (파트너에게만 보임)
export const MEET_INTENTS = ['천천히 알아가고 싶어요', '진지하게 만나고 싶어요', '결혼까지 생각해요'] as const;

// users.meet_intent 칸이 있는지 (add_meet_intent.sql 실행 전이면 false → 묻지 않는다)
export async function fetchMeetIntent(userId: string): Promise<{ available: boolean; value: string | null }> {
  const { data, error } = await supabase.from('users').select('meet_intent').eq('id', userId).maybeSingle();
  if (error) return { available: false, value: null };
  return { available: true, value: ((data as any)?.meet_intent as string) || null };
}

export async function saveMeetIntent(userId: string, value: string | null) {
  return supabase.from('users').update({ meet_intent: value || null }).eq('id', userId);
}
