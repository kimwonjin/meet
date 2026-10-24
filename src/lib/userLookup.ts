// 운영자: 회원·파트너 찾기 (이름 또는 전화번호 뒷자리) + 한 사람의 상태 요약 + 이용 정지·해제
import { supabase } from './supabase';
import { closeOpenMatchesOf } from './safety';

export type FoundUser = {
  id: string; name: string; phone: string; role: string;
  gender?: string | null; age?: number | null; location?: string | null;
  created_at?: string; suspended_at?: string | null; suspended_reason?: string | null; withdrawn_at?: string | null;
};

const USER_FIELDS = 'id, name, phone, role, gender, age, location, created_at, suspended_at, suspended_reason, withdrawn_at';

// 숫자 4자리 이상이면 전화번호로, 아니면 이름으로 찾는다 (운영자 계정은 빼고, 최대 20명)
export async function searchUsers(q: string): Promise<FoundUser[]> {
  const term = q.trim();
  if (!term) return [];
  const digits = term.replace(/\D/g, '');
  let query = supabase.from('users').select(USER_FIELDS).neq('role', 'operator').limit(20);
  if (digits.length >= 4 && digits.length === term.replace(/[\s-]/g, '').length) {
    query = query.ilike('phone', `%${digits.slice(-4)}`);
  } else {
    query = query.ilike('name', `%${term.replace(/[%_,()]/g, '')}%`);
  }
  const { data, error } = await query;
  if (error) return [];
  let rows = (data || []) as FoundUser[];
  // 뒷자리보다 길게 넣었으면 그 숫자가 모두 들어 있는 번호만
  if (digits.length > 4 && digits.length === term.replace(/[\s-]/g, '').length) rows = rows.filter((u) => (u.phone || '').replace(/\D/g, '').includes(digits));
  return rows.sort((a, b) => Number(!!a.withdrawn_at) - Number(!!b.withdrawn_at) || (a.name || '').localeCompare(b.name || ''));
}

export type UserSummary = {
  partners: { name: string; status: string }[];   // 회원: 가입한 파트너
  creditsLeft: number;                              // 회원: 남은 이용권 (무료 포함)
  activeMatches: number;                            // 진행 중 매칭
  doneMatches: number;                              // 끝난 매칭
  reportsAgainst: number;                           // 이 사람이 받은 신고
  openReportsAgainst: number;
  reportsMade: number;
  partner?: { businessName: string; status: string; fee: number | null; members: number; pendingMembers: number; pendingWithdrawals: number };
};

export async function getUserSummary(u: FoundUser): Promise<UserSummary> {
  const id = u.id;
  const isPartner = u.role === 'connector';
  const [req, pay, m1, rAgainst, rMade] = await Promise.all([
    isPartner
      ? supabase.from('hopeful_requests').select('status').eq('connector_id', id)
      : supabase.from('hopeful_requests').select('connector_id, status').eq('hopeful_id', id),
    isPartner ? Promise.resolve({ data: [] as any[] }) : supabase.from('payments').select('sessions_remaining, status').eq('hopeful_id', id).eq('status', 'paid'),
    supabase.from('match_requests').select('id, status, settlement_completed').or(isPartner ? `connector_1_id.eq.${id},connector_2_id.eq.${id}` : `hopeful_1_id.eq.${id},hopeful_2_id.eq.${id}`),
    supabase.from('user_reports').select('status').eq('target_id', id),
    supabase.from('user_reports').select('id').eq('reporter_id', id),
  ]);
  const matches = ((m1 as any).data || []) as any[];
  const reports = ((rAgainst as any).data || []) as any[];
  const out: UserSummary = {
    partners: [],
    creditsLeft: (((pay as any).data || []) as any[]).reduce((n, p) => n + (p.sessions_remaining || 0), 0),
    activeMatches: matches.filter((m) => m.status !== 'rejected' && !m.settlement_completed).length,
    doneMatches: matches.filter((m) => m.settlement_completed).length,
    reportsAgainst: reports.length,
    openReportsAgainst: reports.filter((r) => r.status === 'open').length,
    reportsMade: (((rMade as any).data || []) as any[]).length,
  };
  const reqs = ((req as any).data || []) as any[];
  if (isPartner) {
    const [{ data: c }, { data: w }] = await Promise.all([
      supabase.from('connectors').select('business_name, status, fee_per_session').eq('id', id).maybeSingle(),
      supabase.from('withdrawal_requests').select('id').eq('connector_id', id).eq('status', 'pending'),
    ]);
    out.partner = {
      businessName: (c as any)?.business_name || '',
      status: (c as any)?.status || '',
      fee: (c as any)?.fee_per_session ?? null,
      members: reqs.filter((r) => r.status === 'approved').length,
      pendingMembers: reqs.filter((r) => r.status === 'pending').length,
      pendingWithdrawals: (w || []).length,
    };
  } else if (reqs.length) {
    const ids = [...new Set(reqs.map((r) => r.connector_id))];
    const { data: cs } = await supabase.from('connectors').select('id, business_name').in('id', ids);
    out.partners = reqs.map((r) => ({ name: (cs || []).find((c: any) => c.id === r.connector_id)?.business_name || '파트너', status: r.status }));
  }
  return out;
}

export async function suspendUser(id: string, reason: string): Promise<{ ok: boolean; closed: number }> {
  const { error } = await supabase.from('users').update({ suspended_at: new Date().toISOString(), suspended_reason: reason }).eq('id', id);
  if (error) return { ok: false, closed: 0 };
  const closed = await closeOpenMatchesOf(id).catch(() => 0);
  return { ok: true, closed };
}

export async function unsuspendUser(id: string) {
  const { error } = await supabase.from('users').update({ suspended_at: null, suspended_reason: null }).eq('id', id);
  return !error;
}
