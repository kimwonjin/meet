// 파트너 '자리 비움': 휴가 등으로 정한 날까지 답이 늦을 수 있다고 회원 채팅에 알린다 (그동안 주간 독려 알림도 쉰다)
// connectors.away_until(날짜). SQL(add_partner_away_and_impression.sql) 실행 전에는 available=false → 화면에서 숨긴다
import { supabase } from './supabase';

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (days: number, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + days); return dateKey(d); };

// 오늘을 포함해 아직 자리 비움 중인지
export const isAway = (until?: string | null) => !!until && until >= dateKey(new Date());

// '10월 31일(금)'
export function awayLabel(until: string) {
  const [y, m, d] = until.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}월 ${d}일(${'일월화수목금토'[dt.getDay()]})`;
}

export async function getAway(partnerId: string): Promise<{ available: boolean; until: string | null }> {
  const { data, error } = await supabase.from('connectors').select('away_until').eq('id', partnerId).maybeSingle();
  if (error) return { available: false, until: null };
  const until = (data as any)?.away_until ?? null;
  return { available: true, until: isAway(until) ? until : null };
}

export async function setAway(partnerId: string, until: string | null) {
  const { error } = await supabase.from('connectors').update({ away_until: until }).eq('id', partnerId);
  return !error;
}
