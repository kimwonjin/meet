// '다음엔 이런 분이면 좋겠어요': 회원이 거절하거나 애프터를 고를 때 남기는 한 줄 (가장 최근 것만, 담당 파트너만 봄)
// users.next_wish (add_next_wish.sql). 실행 전에는 available=false → 입력 칸을 숨긴다
import { supabase } from './supabase';

export const NEXT_WISH_MAX = 100;

export async function nextWishAvailable(userId: string): Promise<boolean> {
  const { error } = await supabase.from('users').select('next_wish').eq('id', userId).maybeSingle();
  return !error;
}

export async function saveNextWish(userId: string, text: string) {
  const t = text.trim().slice(0, NEXT_WISH_MAX);
  if (!t) return;
  await supabase.from('users').update({ next_wish: t }).eq('id', userId);
}

export async function fetchNextWish(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('users').select('next_wish').eq('id', userId).maybeSingle();
  if (error) return null;
  return ((data as any)?.next_wish as string) || null;
}
