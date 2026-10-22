// 파트너 월간 리포트: 이번 달 소개·만남·정산을 한눈에, 지난달과 비교
// 기준 (한국 시간 달력의 한 달)
// - 매칭 제안: 그 달에 만든 제안 (동맹 매칭 포함)
// - 만남 성사: 그 달에 만남 완료된 건 (노쇼 제외)
// - 다시 만나고 싶어함: 그 달 만남 중 두 회원 모두 다음 만남을 원한 건
// - 정산금: 그 달에 생긴 내 정산금 (출금 여부와 관계없이)
// - 새 회원: 그 달에 가입 신청해서 승인된 내 회원
// - 만남까지 간 비율: 그 달 제안 중 결과가 나온 제안에서 만남까지 간 비율
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type Data = { matches: any[]; settlements: any[]; members: any[] };

const monthKey = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
};
const shift = (y: number, m: number, by: number) => {
  const d = new Date(y, m - 1 + by, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
};
const won = (n: number) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만원` : `${n.toLocaleString()}원`);

export function computeMonth(data: Data, y: number, m: number) {
  const key = `${y}-${m}`;
  const proposed = data.matches.filter((r) => monthKey(r.created_at) === key);
  const met = data.matches.filter((r) => r.meeting_status === 'completed' && r.closed_reason !== 'no_show' && monthKey(r.meeting_completed_at || r.meeting_scheduled_at) === key);
  const mutual = met.filter((r) => r.after_care_hopeful_1 === '신청' && r.after_care_hopeful_2 === '신청');
  const earned = data.settlements.filter((s) => monthKey(s.created_at) === key).reduce((n, s) => n + Number(s.connector_payout || 0), 0);
  const newMembers = data.members.filter((r) => monthKey(r.created_at) === key).length;
  const decided = proposed.filter((r) => r.meeting_status === 'completed' || r.status === 'rejected');
  const reached = decided.filter((r) => r.meeting_status === 'completed' && r.closed_reason !== 'no_show');
  return {
    proposed: proposed.length,
    met: met.length,
    mutual: mutual.length,
    earned,
    newMembers,
    rate: decided.length ? Math.round((reached.length / decided.length) * 100) : null,
    pending: proposed.length - decided.length,
  };
}

export default function PartnerReportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible || !user) return;
    let alive = true;
    setError(false);
    (async () => {
      const cols = 'id, created_at, status, meeting_status, meeting_completed_at, meeting_scheduled_at, closed_reason, after_care_hopeful_1, after_care_hopeful_2';
      const [a, b, s, h] = await Promise.all([
        supabase.from('match_requests').select(cols).eq('connector_1_id', user.id),
        supabase.from('match_requests').select(cols).eq('connector_2_id', user.id),
        supabase.from('settlements').select('connector_payout, created_at').eq('connector_id', user.id),
        supabase.from('hopeful_requests').select('created_at').eq('connector_id', user.id).eq('status', 'approved'),
      ]);
      if (!alive) return;
      if (a.error || b.error) { setError(true); return; }
      // 내 회원끼리 매칭은 두 조회에 모두 나오므로 한 번만 센다
      const byId = new Map<string, any>();
      for (const r of [...(a.data || []), ...(b.data || [])]) byId.set(r.id, r);
      setData({ matches: [...byId.values()], settlements: s.data || [], members: h.data || [] });
    })().catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [visible, user?.id]);

  const cur = useMemo(() => (data ? computeMonth(data, ym.y, ym.m) : null), [data, ym]);
  const prevYm = shift(ym.y, ym.m, -1);
  const prev = useMemo(() => (data ? computeMonth(data, prevYm.y, prevYm.m) : null), [data, ym]);
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth() + 1;

  const delta = (a: number, b: number, fmt: (n: number) => string = (n) => `${n}`) => {
    const d = a - b;
    if (d === 0) return '지난달과 같아요';
    return `지난달보다 ${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
  };

  const headline = !cur ? '' : cur.met > 0
    ? `${isThisMonth ? '이번 달' : `${ym.m}월에`} ${cur.met}쌍이 만났어요 👏`
    : cur.proposed > 0 ? `${isThisMonth ? '이번 달' : `${ym.m}월에`} ${cur.proposed}건을 소개했어요` : `${isThisMonth ? '이번 달' : `${ym.m}월에`}는 아직 소개가 없어요`;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="월간 리포트">
      <View style={s.monthRow}>
        <TouchableOpacity onPress={() => setYm(shift(ym.y, ym.m, -1))} hitSlop={10} accessibilityLabel="이전 달">
          <Text style={s.arrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.month}>{ym.y}년 {ym.m}월</Text>
        <TouchableOpacity onPress={() => !isThisMonth && setYm(shift(ym.y, ym.m, 1))} disabled={isThisMonth} hitSlop={10} accessibilityLabel="다음 달">
          <Text style={[s.arrow, isThisMonth && s.arrowOff]}>›</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <Text style={s.empty}>리포트를 불러오지 못했어요. 잠시 후 다시 열어 주세요</Text>
      ) : !cur || !prev ? (
        <ActivityIndicator color="#5B21FF" style={{ marginVertical: 40 }} />
      ) : (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Text style={s.headline}>{headline}</Text>
          <View style={s.grid}>
            {([
              ['매칭 제안', `${cur.proposed}건`, delta(cur.proposed, prev.proposed, (n) => `${n}건`)],
              ['만남 성사', `${cur.met}쌍`, delta(cur.met, prev.met, (n) => `${n}쌍`)],
              ['정산금', won(cur.earned), delta(cur.earned, prev.earned, won)],
              ['새 회원', `${cur.newMembers}명`, delta(cur.newMembers, prev.newMembers, (n) => `${n}명`)],
              ['다시 만나고 싶어함', `${cur.mutual}쌍`, cur.met ? `만남 ${cur.met}쌍 중` : '만남이 생기면 보여요'],
              ['만남까지 간 비율', cur.rate === null ? '-' : `${cur.rate}%`, cur.pending > 0 ? `진행 중 ${cur.pending}건은 결과가 나오면 반영` : '결과가 나온 제안 기준'],
            ] as const).map(([label, value, sub]) => (
              <View key={label} style={s.tile} accessibilityLabel={`${label} ${value}`}>
                <Text style={s.tileLabel}>{label}</Text>
                <Text style={s.tileValue}>{value}</Text>
                <Text style={s.tileSub} numberOfLines={2}>{sub}</Text>
              </View>
            ))}
          </View>
          <Text style={s.note}>정산금은 그 달에 생긴 금액이에요. 출금은 마이 › 계좌 정보에서 신청할 수 있어요</Text>
        </View>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 12 },
  month: { fontSize: 16, fontWeight: '700', color: '#322F38' },
  arrow: { fontSize: 26, color: '#5B21FF', paddingHorizontal: 8 },
  arrowOff: { color: '#DCD9E2' },
  headline: { fontSize: 18, fontWeight: '800', color: '#322F38' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: '#F8F7FA', borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 12, color: '#87848D' },
  tileValue: { fontSize: 22, fontWeight: '800', color: '#322F38', marginTop: 4 },
  tileSub: { fontSize: 11, color: '#98959E', marginTop: 4, lineHeight: 15 },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18 },
  empty: { fontSize: 14, color: '#87848D', textAlign: 'center', marginVertical: 40 },
});
