// 파트너가 회원에 대해 남기는 것
// - 메모: 그 파트너만 보는 기록 (선호 조건, 상담 내용 등)
// - 직접 만나 확인: 파트너가 회원을 직접 만나 신분을 확인했다는 표시. 다른 파트너·소개받는 상대에게도 보인다
// SQL(add_member_notes.sql) 실행 전에는 available=false → 화면에서 숨긴다
import { supabase } from './supabase';

// 회원들 중 파트너가 직접 만나 확인한 회원
export async function fetchVerifiedIds(memberIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from('hopeful_requests')
    .select('hopeful_id')
    .in('hopeful_id', ids)
    .eq('status', 'approved')
    .not('identity_checked_at', 'is', null);
  if (error) return new Set();
  return new Set((data || []).map((r: any) => r.hopeful_id as string));
}

export type MemberNote = { available: boolean; note: string; checkedAt: string | null; checkAvailable: boolean };

export async function getMemberNote(connectorId: string, memberId: string): Promise<MemberNote> {
  const [n, r] = await Promise.all([
    supabase.from('member_notes').select('note').eq('connector_id', connectorId).eq('hopeful_id', memberId).maybeSingle(),
    supabase.from('hopeful_requests').select('identity_checked_at').eq('connector_id', connectorId).eq('hopeful_id', memberId).eq('status', 'approved').limit(1),
  ]);
  return {
    available: !n.error,
    note: (n.data as any)?.note || '',
    checkAvailable: !r.error,
    checkedAt: ((r.data as any[]) || [])[0]?.identity_checked_at ?? null,
  };
}

export async function saveMemberNote(connectorId: string, memberId: string, note: string) {
  const { error } = await supabase
    .from('member_notes')
    .upsert({ connector_id: connectorId, hopeful_id: memberId, note: note.slice(0, 2000), updated_at: new Date().toISOString() }, { onConflict: 'connector_id,hopeful_id' });
  return !error;
}

// 확인 표시 켜기·끄기. 내 회원(승인된 회원)에게만 걸 수 있다
export async function setIdentityChecked(connectorId: string, memberId: string, checked: boolean) {
  const at = checked ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from('hopeful_requests')
    .update({ identity_checked_at: at })
    .eq('connector_id', connectorId)
    .eq('hopeful_id', memberId)
    .eq('status', 'approved')
    .select('id');
  if (error || !data?.length) return { ok: false as const };
  return { ok: true as const, at };
}
