// 아는 사람 피하기: 같은 회사, 등록한 전화번호의 사람과는 서로 소개되지 않는다
// 번호는 되돌릴 수 없는 값(phoneHash)으로만 저장하고, 화면에는 뒷자리만 보여준다
// SQL(add_company_and_avoid.sql) 실행 전에는 available=false → 메뉴를 숨긴다
import { supabase } from './supabase';
import { phoneHash } from './withdrawal';

export type AvoidState = { available: boolean; company: string | null; avoidCompany: boolean; contacts: { phone_hash: string; label: string | null }[] };

export async function getAvoidState(userId: string): Promise<AvoidState> {
  const [{ data: me, error }, { data: list, error: e2 }] = await Promise.all([
    supabase.from('users').select('company, avoid_same_company').eq('id', userId).maybeSingle(),
    supabase.from('avoid_contacts').select('phone_hash, label').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  if (error || e2) return { available: false, company: null, avoidCompany: false, contacts: [] };
  return { available: true, company: (me as any)?.company || null, avoidCompany: !!(me as any)?.avoid_same_company, contacts: (list || []) as any[] };
}

export async function setAvoidCompany(userId: string, on: boolean) {
  const { error } = await supabase.from('users').update({ avoid_same_company: on }).eq('id', userId);
  return !error;
}

export const maskPhone = (digits: string) => `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;

export async function addAvoidContact(userId: string, myPhone: string, phone: string): Promise<'ok' | 'invalid' | 'self' | 'dup' | 'error'> {
  const digits = phone.replace(/\D/g, '');
  if (!/^01\d{8,9}$/.test(digits)) return 'invalid';
  if (digits === myPhone.replace(/\D/g, '')) return 'self';
  const hash = await phoneHash(digits);
  if (!hash) return 'error';
  const { data: exists } = await supabase.from('avoid_contacts').select('phone_hash').eq('user_id', userId).eq('phone_hash', hash).limit(1);
  if (exists?.length) return 'dup';
  const { error } = await supabase.from('avoid_contacts').insert({ user_id: userId, phone_hash: hash, label: maskPhone(digits) });
  if (error) return error.code === '23505' ? 'dup' : 'error';
  return 'ok';
}

export async function removeAvoidContact(userId: string, hash: string) {
  const { error } = await supabase.from('avoid_contacts').delete().eq('user_id', userId).eq('phone_hash', hash);
  return !error;
}

// 서로 소개하면 안 되는 두 사람 ('작은id|큰id'). SQL 전이면 빈 목록
export async function fetchAvoidPairs(ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(Boolean))];
  if (list.length < 2) return new Set();
  const { data, error } = await supabase.rpc('fn_avoid_pairs', { p_ids: list });
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as any[]).map((r) => [r.a, r.b].sort().join('|')));
}
