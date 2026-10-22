// 회원이 원하는 상대 (선호 조건). 파트너가 후보를 고를 때 참고한다 (회원끼리는 보이지 않음)
// 고르지 않은 항목은 '상관없어요'. 상대 정보가 비어 있으면 맞는지 따지지 않는다
// SQL(add_pause_and_preferences.sql) 실행 전에는 available=false → 화면에서 숨긴다
import { supabase } from './supabase';

export type AgeKey = '20s' | '30e' | '30l' | '40s' | '50p';
export type Prefs = { ages: AgeKey[]; regions: string[]; heightMin: number | null; nonSmoker: boolean };

export const AGE_OPTIONS: [AgeKey, string, number, number][] = [
  ['20s', '20대', 20, 29],
  ['30e', '30대 초반', 30, 34],
  ['30l', '30대 후반', 35, 39],
  ['40s', '40대', 40, 49],
  ['50p', '50대 이상', 50, 200],
];
export const PREF_REGIONS = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주'];
export const HEIGHT_OPTIONS = [155, 160, 165, 170, 175, 180];

export const EMPTY_PREFS: Prefs = { ages: [], regions: [], heightMin: null, nonSmoker: false };

export function normalizePrefs(raw: any): Prefs {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PREFS };
  const ageKeys = AGE_OPTIONS.map((a) => a[0]);
  return {
    ages: Array.isArray(raw.ages) ? raw.ages.filter((a: any) => ageKeys.includes(a)) : [],
    regions: Array.isArray(raw.regions) ? raw.regions.filter((r: any) => typeof r === 'string') : [],
    heightMin: typeof raw.heightMin === 'number' ? raw.heightMin : null,
    nonSmoker: !!raw.nonSmoker,
  };
}

export const hasPrefs = (p?: Prefs | null) => !!p && (p.ages.length > 0 || p.regions.length > 0 || p.heightMin !== null || p.nonSmoker);

// '30대 초반·30대 후반 · 서울·경기 · 170cm 이상 · 비흡연'
export function prefsSummary(p?: Prefs | null) {
  if (!hasPrefs(p)) return '';
  const parts = [
    p!.ages.length ? AGE_OPTIONS.filter((a) => p!.ages.includes(a[0])).map((a) => a[1]).join('·') : '',
    p!.regions.length ? p!.regions.join('·') : '',
    p!.heightMin ? `${p!.heightMin}cm 이상` : '',
    p!.nonSmoker ? '비흡연' : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

type Person = { age?: number | null; location?: string | null; height?: number | null; smoking?: string | null };

// 원하는 조건(p) 중 상대(c)가 맞지 않는 항목. 상대 정보가 없으면 따지지 않는다
export function unmetPrefs(p: Prefs | undefined | null, c: Person): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.ages.length && c.age) {
    const ok = AGE_OPTIONS.some(([k, , lo, hi]) => p.ages.includes(k) && c.age! >= lo && c.age! <= hi);
    if (!ok) out.push('나이');
  }
  if (p.regions.length && c.location && !p.regions.some((r) => c.location!.includes(r))) out.push('지역');
  if (p.heightMin && c.height && c.height < p.heightMin) out.push('키');
  if (p.nonSmoker && c.smoking && c.smoking !== '비흡연') out.push('흡연');
  return out;
}

// 두 회원이 서로의 조건에 맞는지. 둘 다 조건이 없으면 null (표시하지 않음)
export function mutualFit(a: Person, pa: Prefs | undefined, b: Person, pb: Prefs | undefined) {
  if (!hasPrefs(pa) && !hasPrefs(pb)) return null;
  const aMiss = unmetPrefs(pa, b); // a가 원하는 것 중 b가 안 맞는 것
  const bMiss = unmetPrefs(pb, a);
  return { ok: !aMiss.length && !bMiss.length, miss: [...new Set([...aMiss, ...bMiss])] };
}

export async function getMyPrefs(userId: string): Promise<{ available: boolean; prefs: Prefs }> {
  const { data, error } = await supabase.from('users').select('preferences').eq('id', userId).maybeSingle();
  if (error) return { available: false, prefs: { ...EMPTY_PREFS } };
  return { available: true, prefs: normalizePrefs((data as any)?.preferences) };
}

export async function saveMyPrefs(userId: string, prefs: Prefs) {
  const { error } = await supabase.from('users').update({ preferences: hasPrefs(prefs) ? prefs : null }).eq('id', userId);
  return !error;
}

export async function fetchPrefs(ids: string[]): Promise<Map<string, Prefs>> {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const { data, error } = await supabase.from('users').select('id, preferences').in('id', list).not('preferences', 'is', null);
  if (error) return new Map();
  return new Map(((data || []) as any[]).map((r) => [r.id as string, normalizePrefs(r.preferences)]));
}
