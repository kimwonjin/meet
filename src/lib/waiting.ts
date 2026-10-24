// 소개를 오래 기다리는 회원 (파트너 홈 '할 일')
// 이용권이 남아 있는데 마지막 소개(또는 가입 승인) 뒤 30일 넘게 새 소개가 없는 내 회원.
// 진행 중인 소개가 있거나, 쉬는 중·탈퇴·정지한 회원은 뺀다
import { supabase } from './supabase';
import { fetchPausedIds } from './pause';

export const WAITING_DAYS = 30;
export const PENDING_JOIN_DAYS = 7;

const DAY = 86400000;
export const daysSince = (iso?: string | null, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : 0);

export type WaitingMember = { id: string; name: string; days: number };

export async function fetchWaitingMembers(partnerId: string): Promise<WaitingMember[]> {
  const [{ data: reqs }, { data: pays }] = await Promise.all([
    supabase.from('hopeful_requests').select('hopeful_id, created_at').eq('connector_id', partnerId).eq('status', 'approved'),
    supabase.from('payments').select('hopeful_id, sessions_remaining').eq('connector_id', partnerId).eq('status', 'paid').gt('sessions_remaining', 0),
  ]);
  const withCredits = new Set(((pays || []) as any[]).map((p) => p.hopeful_id as string));
  const joined = new Map<string, string>();
  for (const r of (reqs || []) as any[]) if (withCredits.has(r.hopeful_id)) joined.set(r.hopeful_id, r.created_at);
  const ids = [...joined.keys()];
  if (!ids.length) return [];

  const [{ data: users }, { data: m1 }, { data: m2 }, paused] = await Promise.all([
    supabase.from('users').select('id, name, withdrawn_at, suspended_at').in('id', ids),
    supabase.from('match_requests').select('hopeful_1_id, hopeful_2_id, created_at, status, settlement_completed').in('hopeful_1_id', ids),
    supabase.from('match_requests').select('hopeful_1_id, hopeful_2_id, created_at, status, settlement_completed').in('hopeful_2_id', ids),
    fetchPausedIds(ids),
  ]);
  const last = new Map<string, string>(joined);
  const busy = new Set<string>();
  for (const m of [...(m1 || []), ...(m2 || [])] as any[]) {
    for (const id of [m.hopeful_1_id, m.hopeful_2_id]) {
      if (!joined.has(id)) continue;
      if (m.status !== 'rejected' && !m.settlement_completed) busy.add(id);
      if (m.created_at && m.created_at > (last.get(id) || '')) last.set(id, m.created_at);
    }
  }
  const now = Date.now();
  return ((users || []) as any[])
    .filter((u) => !u.withdrawn_at && !u.suspended_at && !busy.has(u.id) && !paused.has(u.id))
    .map((u) => ({ id: u.id as string, name: (u.name as string) || '회원', days: daysSince(last.get(u.id), now) }))
    .filter((w) => w.days >= WAITING_DAYS)
    .sort((a, b) => b.days - a.days);
}

// 회원별 마지막 소개 시각 (회원 목록 '오래 기다린 순' 정렬용). 소개가 없으면 빠진다
export async function fetchLastIntroAt(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  const [{ data: m1 }, { data: m2 }] = await Promise.all([
    supabase.from('match_requests').select('hopeful_1_id, hopeful_2_id, created_at').in('hopeful_1_id', list),
    supabase.from('match_requests').select('hopeful_1_id, hopeful_2_id, created_at').in('hopeful_2_id', list),
  ]);
  for (const m of [...(m1 || []), ...(m2 || [])] as any[]) {
    for (const id of [m.hopeful_1_id, m.hopeful_2_id]) {
      if (list.includes(id) && m.created_at && m.created_at > (out.get(id) || '')) out.set(id, m.created_at);
    }
  }
  return out;
}
