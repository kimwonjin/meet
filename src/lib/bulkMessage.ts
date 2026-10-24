// 파트너 '여러 회원에게 보내기': 고른 내 회원 각자의 채팅방으로 같은 글을 보낸다 (연휴·공지 안내용)
// 스팸이 되지 않도록 한 번에 30명, 하루 3번까지 (이 기기 기준). 서로 차단했거나 탈퇴·정지한 회원은 건너뛴다
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getOrCreateThread, sendMessage } from './chat';

export const BULK_MAX_PEOPLE = 30;
export const BULK_MAX_PER_DAY = 3;
export const NAME_TOKEN = '{이름}';

const today = () => new Date().toISOString().slice(0, 10);
const key = (userId: string) => `dudu_bulk_sent_${userId}`;

export async function bulkSentToday(userId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const v = raw ? JSON.parse(raw) : null;
    return v?.day === today() ? Number(v.n) || 0 : 0;
  } catch { return 0; }
}

async function markSent(userId: string) {
  const n = await bulkSentToday(userId);
  await AsyncStorage.setItem(key(userId), JSON.stringify({ day: today(), n: n + 1 })).catch(() => {});
}

export type BulkResult = { sent: number; skipped: number };

export async function sendBulk(partnerId: string, members: { id: string; name: string }[], text: string, onProgress?: (done: number) => void): Promise<BulkResult> {
  const ids = members.map((m) => m.id);
  const [{ data: blocks }, { data: users }] = await Promise.all([
    supabase.from('user_blocks').select('blocker_id, blocked_id').or(`blocker_id.eq.${partnerId},blocked_id.eq.${partnerId}`),
    supabase.from('users').select('id, withdrawn_at, suspended_at').in('id', ids),
  ]);
  const blocked = new Set<string>();
  for (const b of (blocks || []) as any[]) blocked.add(b.blocker_id === partnerId ? b.blocked_id : b.blocker_id);
  const inactive = new Set(((users || []) as any[]).filter((u) => u.withdrawn_at || u.suspended_at).map((u) => u.id as string));

  let sent = 0, skipped = 0;
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    onProgress?.(i);
    if (blocked.has(m.id) || inactive.has(m.id)) { skipped++; continue; }
    const threadId = await getOrCreateThread(partnerId, m.id);
    if (!threadId) { skipped++; continue; }
    const { error } = await sendMessage(threadId, partnerId, text.split(NAME_TOKEN).join(m.name || '회원'));
    if (error) { skipped++; if ((error as any).code === 'INACTIVE') break; } else sent++;
  }
  onProgress?.(members.length);
  if (sent) await markSent(partnerId);
  return { sent, skipped };
}
