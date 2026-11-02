// 파트너 모임 이름 중복 막기: 활동 중·심사 중인 파트너와 같은 이름은 쓸 수 없다 (회원 혼란·사칭 방지)
// 띄어쓰기·대소문자·(주)·주식회사 차이는 같은 이름으로 본다. 탈퇴·정지·반려된 파트너의 이름은 다시 쓸 수 있다
import { supabase } from './supabase';

export const normName = (s: string) => s.toLowerCase().replace(/\(주\)|㈜|주식회사|\s+|[·.\-_]/g, '');

export async function isNameTaken(name: string, myId?: string): Promise<boolean> {
  const key = normName(name);
  if (!key) return false;
  const { data, error } = await supabase.from('connectors').select('id, business_name').in('status', ['approved', 'pending']);
  if (error) return false; // 확인하지 못하면 막지 않는다
  const same = ((data || []) as any[]).filter((c) => c.id !== myId && normName(c.business_name || '') === key);
  if (!same.length) return false;
  const { data: users } = await supabase.from('users').select('id, withdrawn_at, suspended_at').in('id', same.map((c) => c.id));
  const gone = new Set(((users || []) as any[]).filter((u) => u.withdrawn_at || u.suspended_at).map((u) => u.id));
  return same.some((c) => !gone.has(c.id));
}

export const NAME_TAKEN_MSG = '이미 다른 파트너가 쓰는 이름이에요. 지역이나 이름을 붙여 보세요 (예: 행복매칭 강남)';
