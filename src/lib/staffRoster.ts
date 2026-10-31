// 종사자 명단: 회사 결혼중개업의 종사자 = 활동 중인 파트너 (파트너 약관 제2조)
// 파트너가 새로 승인되거나 그만두면 구청에 변경신고를 해야 한다 (시행규칙 제3조 ① 4호, 안 하면 과태료 300만원 이하)
// '변경신고 했어요'를 누른 때의 명단을 서버(platform_settings.staff_reported)에 저장해 두고, 지금 명단과 비교해 신고할 사람을 알려 준다
// SQL(add_staff_reported.sql) 실행 전이면 이 기기에 저장한다
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const KEY = 'dudu_staff_reported';

export type Staff = { id: string; name: string; business: string; phone: string; since: string };
export type Reported = { at: string; ids: string[]; names: Record<string, string> };

export async function fetchStaff(): Promise<Staff[]> {
  const { data: conns } = await supabase.from('connectors').select('id, business_name, created_at').eq('status', 'approved');
  const list = (conns || []) as any[];
  if (!list.length) return [];
  const { data: users } = await supabase.from('users').select('id, name, phone, withdrawn_at, suspended_at, role').in('id', list.map((c) => c.id));
  const u = new Map(((users || []) as any[]).map((x) => [x.id, x]));
  return list
    .filter((c) => { const x = u.get(c.id); return x && !x.withdrawn_at && !x.suspended_at && x.role === 'connector'; })
    .map((c) => { const x = u.get(c.id); return { id: c.id, name: x.name || '', business: c.business_name || '', phone: x.phone || '', since: c.created_at || '' }; })
    .sort((a, b) => a.since.localeCompare(b.since));
}

export async function getReported(): Promise<Reported | null> {
  const { data, error } = await supabase.from('platform_settings').select('staff_reported').eq('id', 1).maybeSingle();
  if (!error) {
    const v = (data as any)?.staff_reported;
    if (v && Array.isArray(v.ids)) return v as Reported;
  }
  // 서버에 없으면(칸이 없거나 처음) 이 기기 기록
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// 저장한 곳: 'server' 또는 'device'
export async function markReported(staff: Staff[]): Promise<{ reported: Reported; where: 'server' | 'device' }> {
  const r: Reported = { at: new Date().toISOString(), ids: staff.map((s) => s.id), names: Object.fromEntries(staff.map((s) => [s.id, s.name])) };
  await AsyncStorage.setItem(KEY, JSON.stringify(r)).catch(() => {});
  const { error } = await supabase.from('platform_settings').upsert({ id: 1, staff_reported: r }, { onConflict: 'id' });
  return { reported: r, where: error ? 'device' : 'server' };
}

// 지난 신고 뒤로 새로 들어온 사람·나간 사람 (한 번도 신고 안 했으면 모두 새로)
export function diffStaff(staff: Staff[], reported: Reported | null) {
  const before = new Set(reported?.ids || []);
  const now = new Set(staff.map((s) => s.id));
  const added = staff.filter((s) => !before.has(s.id));
  const removed = [...before].filter((id) => !now.has(id)).map((id) => ({ id, name: reported?.names[id] || '이름 모름' }));
  return { added, removed, count: added.length + removed.length };
}

// 명단 파일 (엑셀에서 열리는 CSV)
export function downloadStaffCsv(staff: Staff[]) {
  if (typeof document === 'undefined') return false;
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['순번', '이름', '활동명', '전화번호', '활동 시작일'], ...staff.map((s, i) => [String(i + 1), s.name, s.business, s.phone, s.since.slice(0, 10)])];
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `dudu_staff_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
