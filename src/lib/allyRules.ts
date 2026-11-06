import { supabase } from './supabase';
import { formatRegions } from './format';

// 동맹 받는 조건: 받는 파트너가 정하고, 요청하는 쪽은 조건이 맞을 때만 요청할 수 있다
// (connectors.ally_rules, add_ally_rules.sql 실행 전에는 칸이 없어 누구나 요청 가능)
export type AllyRules = { minMembers: number; sameRegion: boolean; accepting: boolean };
export const DEFAULT_ALLY_RULES: AllyRules = { minMembers: 0, sameRegion: false, accepting: true };
export const MIN_MEMBER_OPTIONS = [0, 3, 5, 10, 20];

export const normalizeRules = (r: any): AllyRules => ({
  minMembers: MIN_MEMBER_OPTIONS.includes(Number(r?.minMembers)) ? Number(r.minMembers) : 0,
  sameRegion: !!r?.sameRegion,
  accepting: r?.accepting !== false,
});

export const isDefaultRules = (r: AllyRules) => !r.minMembers && !r.sameRegion && r.accepting;

export const regionsOf = (mainRegion?: string | null) =>
  (formatRegions(mainRegion) || '').split(',').map((s) => s.trim()).filter(Boolean);

// 파트너마다 조건 (available=false면 칸이 없음 → 조건 기능을 숨긴다)
export async function fetchAllyRules(): Promise<{ available: boolean; map: Record<string, AllyRules> }> {
  const { data, error } = await supabase.from('connectors').select('id, ally_rules');
  if (error) return { available: false, map: {} };
  return { available: true, map: Object.fromEntries((data || []).map((c: any) => [c.id, normalizeRules(c.ally_rules)])) };
}

export async function fetchRulesOf(connectorId: string): Promise<AllyRules | null> {
  const { data, error } = await supabase.from('connectors').select('ally_rules').eq('id', connectorId).maybeSingle();
  if (error) return null;
  return normalizeRules((data as any)?.ally_rules);
}

export function saveAllyRules(connectorId: string, rules: AllyRules) {
  return supabase.from('connectors').update({ ally_rules: rules }).eq('id', connectorId);
}

// 카드에 보여 줄 한 줄 (조건이 없으면 null)
export function rulesSummary(r: AllyRules, ownerRegions: string[] = []): string | null {
  if (!r.accepting) return '지금은 요청을 받지 않아요';
  const parts = [r.minMembers ? `회원 ${r.minMembers}명+` : null, r.sameRegion ? (ownerRegions.length ? `${ownerRegions.join('·')} 파트너만` : '같은 지역만') : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// 요청하려는 내가 받는 쪽 조건에 맞는지. 맞으면 null, 아니면 이유
// myTotal: 내 회원 수 (모르면 null → 회원 수 조건은 보지 않는다)
export function ruleBlock(
  r: AllyRules | undefined,
  me: { total: number | null; regions: string[] },
  owner: { regions: string[] }
): { kind: 'closed' | 'members' | 'region'; text: string } | null {
  if (!r) return null;
  if (!r.accepting) return { kind: 'closed', text: '지금은 동맹 요청을 받지 않아요' };
  if (r.minMembers && me.total !== null && me.total < r.minMembers) {
    return { kind: 'members', text: `회원 ${r.minMembers}명부터 요청할 수 있어요 (지금 ${me.total}명)` };
  }
  if (r.sameRegion && owner.regions.length && !owner.regions.some((x) => me.regions.includes(x))) {
    return { kind: 'region', text: `${owner.regions.join('·')} 파트너만 받아요` };
  }
  return null;
}
