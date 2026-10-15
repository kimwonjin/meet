// 동맹 궁합: 두 파트너의 회원 구성이 서로 소개하기에 얼마나 잘 맞는지
// - 지역: 회원이 사는 지역이 겹칠수록 (회원 수가 적어 공개되지 않으면 파트너 활동 지역으로)
// - 나이: 내 남성 회원 ↔ 상대 여성 회원, 내 여성 ↔ 상대 남성의 나이대가 가까울수록
// - 또래 이성 수: 내 회원과 같은 나이대의 상대 이성 회원이 많을수록
// - 남녀 균형: 내 남성 수와 상대 여성 수, 내 여성 수와 상대 남성 수가 비슷할수록
//   (둘 다 남성만 많으면 서로 소개할 사람이 적어 낮아진다)
import { formatRegions } from './format';

type Dir = {
  total?: number;
  male?: number;
  female?: number;
  ages?: { gender: string; decade: number; count: number }[] | null;
  regions?: { label: string; count: number }[] | null;
};

export type AllyFit = { score: number; label: '잘 맞아요' | '괜찮아요' | '덜 맞아요'; reasons: string[]; peers: number | null };

const WEIGHTS = { region: 0.3, age: 0.2, gender: 0.2, peers: 0.3 };

function regionList(mainRegion?: string | null) {
  return (formatRegions(mainRegion) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// 두 분포가 얼마나 겹치는지 (0~1)
function shareOverlap(a: Record<string, number>, b: Record<string, number>) {
  const ta = Object.values(a).reduce((s, n) => s + n, 0);
  const tb = Object.values(b).reduce((s, n) => s + n, 0);
  if (!ta || !tb) return null;
  return Object.keys(a).reduce((s, k) => s + Math.min(a[k] / ta, (b[k] || 0) / tb), 0);
}

function regionScore(me: Dir | undefined, other: Dir | undefined, myRegion?: string | null, otherRegion?: string | null) {
  if (me?.regions?.length && other?.regions?.length) {
    const toMap = (r: Dir['regions']) => Object.fromEntries((r || []).map((x) => [x.label, x.count]));
    return shareOverlap(toMap(me.regions), toMap(other.regions));
  }
  const a = regionList(myRegion), b = regionList(otherRegion);
  if (!a.length || !b.length) return null;
  const inter = a.filter((r) => b.includes(r)).length;
  return inter / new Set([...a, ...b]).size;
}

// 이성끼리 나이대가 같으면 1, 한 칸(10살) 차이면 0.5
function ageScore(me: Dir | undefined, other: Dir | undefined) {
  if (!me?.ages?.length || !other?.ages?.length) return null;
  const dist = (d: Dir, g: string) => {
    const m: Record<number, number> = {};
    for (const a of d.ages || []) if (a.gender === g) m[a.decade] = (m[a.decade] || 0) + a.count;
    return m;
  };
  const pair = (x: Record<number, number>, y: Record<number, number>) => {
    const tx = Object.values(x).reduce((s, n) => s + n, 0), ty = Object.values(y).reduce((s, n) => s + n, 0);
    if (!tx || !ty) return null;
    let s = 0;
    for (const [dx, cx] of Object.entries(x)) for (const [dy, cy] of Object.entries(y)) {
      const gap = Math.abs(Number(dx) - Number(dy)) / 10;
      s += (cx / tx) * (cy / ty) * (gap === 0 ? 1 : gap === 1 ? 0.5 : 0);
    }
    return { s, w: Math.min(tx, ty) };
  };
  const parts = [pair(dist(me, 'M'), dist(other, 'F')), pair(dist(me, 'F'), dist(other, 'M'))].filter(Boolean) as { s: number; w: number }[];
  const w = parts.reduce((n, p) => n + p.w, 0);
  // 같은 나이대끼리 만나도 무작위 짝이면 1이 되기 어려워 조금 넉넉하게 본다
  return w ? Math.min(1, (parts.reduce((n, p) => n + p.s * p.w, 0) / w) * 1.6) : null;
}

// 또래 이성 수: 내 회원과 같은 나이대인 상대 파트너의 이성 회원 수 (실제로 소개할 수 있는 사람 수)
function peerCount(me: Dir | undefined, other: Dir | undefined) {
  if (!me?.ages?.length || !other?.ages?.length) return null;
  const has = (g: string, decade: number) => (me.ages || []).some((a) => a.gender === g && a.decade === decade && a.count > 0);
  return (other.ages || []).reduce((n, a) => n + ((a.gender === 'F' && has('M', a.decade)) || (a.gender === 'M' && has('F', a.decade)) ? a.count : 0), 0);
}

function genderScore(me: Dir | undefined, other: Dir | undefined) {
  const mM = me?.male || 0, mF = me?.female || 0, oM = other?.male || 0, oF = other?.female || 0;
  const half = (mM + mF + oM + oF) / 2;
  if (!half || !(mM + mF) || !(oM + oF)) return null;
  return (Math.min(mM, oF) + Math.min(mF, oM)) / half;
}

export function allyFit(me: Dir | undefined, other: Dir | undefined, myRegion?: string | null, otherRegion?: string | null): AllyFit | null {
  const parts = {
    region: regionScore(me, other, myRegion, otherRegion),
    age: ageScore(me, other),
    gender: genderScore(me, other),
    // 내 회원 수의 절반 이상이면 만점 (소개할 사람이 충분)
    peers: null as number | null,
  };
  const peers = peerCount(me, other);
  if (peers !== null) parts.peers = Math.min(1, peers / Math.max(3, (me?.total || 0) / 2));
  const used = (Object.keys(parts) as (keyof typeof parts)[]).filter((k) => parts[k] !== null);
  if (!used.length || parts.gender === null) return null;
  const wsum = used.reduce((s, k) => s + WEIGHTS[k], 0);
  const score = used.reduce((s, k) => s + (parts[k] as number) * WEIGHTS[k], 0) / wsum;
  const reasons: string[] = [];
  if (peers !== null) reasons.push(peers > 0 ? `또래 이성 ${peers}명` : '또래 이성 회원이 없어요');
  if ((parts.region ?? 0) >= 0.5) reasons.push('같은 지역 회원이 많아요');
  else if (parts.region !== null && parts.region < 0.2) reasons.push('지역이 많이 달라요');
  if ((parts.age ?? 0) >= 0.6) reasons.push('나이대가 잘 맞아요');
  if ((parts.gender ?? 0) >= 0.6) reasons.push('남녀 수가 서로 맞아요');
  else if ((parts.gender ?? 1) < 0.3) reasons.push('성별 구성이 겹쳐요');
  return { score, label: score >= 0.6 ? '잘 맞아요' : score >= 0.35 ? '괜찮아요' : '덜 맞아요', reasons, peers };
}
