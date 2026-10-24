// 운영자 현황: 서비스가 잘 굴러가는지 한눈에
// - 기간(오늘·7일·30일)별 숫자와 바로 앞 같은 기간 대비
// - 지금 처리할 일 (누르면 정산관리의 해당 칸으로)
// - 30일 동안 매칭 제안이 없는 파트너 (채팅으로 바로 연락)
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { UserLookupRow } from '@/components/UserLookup';
import { BackupReminder } from '@/components/BackupSettings';
import { reportDeadline } from '@/lib/reportDeadline';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import NoticeComposer from '@/components/NoticeComposer';
import { FeedbackInbox } from '@/components/FeedbackSettings';

type Period = 'today' | 'week' | 'month';
const PERIODS: [Period, string, string][] = [['today', '오늘', '어제'], ['week', '7일', '그 전 7일'], ['month', '30일', '그 전 30일']];

function ranges(p: Period) {
  const now = new Date();
  let start: Date;
  if (p === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else start = new Date(now.getTime() - (p === 'week' ? 7 : 30) * 86400000);
  const len = p === 'today' ? 86400000 : now.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - len);
  return { start: start.toISOString(), end: now.toISOString(), prevStart: prevStart.toISOString() };
}

const won = (n: number) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만원` : `${n.toLocaleString()}원`);

type Stat = { label: string; cur: number; prev: number; fmt?: (n: number) => string; bad?: boolean };
type Idle = { id: string; name: string; days: number };

// 개수 세기 (행을 가져오지 않음)
async function count(table: string, apply: (q: any) => any) {
  const { count: n, error } = await apply(supabase.from(table).select('*', { count: 'exact', head: true }));
  return error ? 0 : n || 0;
}
// 칸이 없으면(SQL 실행 전) null
async function countOrNull(table: string, apply: (q: any) => any) {
  const { count: n, error } = await apply(supabase.from(table).select('*', { count: 'exact', head: true }));
  return error ? null : n || 0;
}
async function sum(table: string, col: string, apply: (q: any) => any) {
  const { data, error } = await apply(supabase.from(table).select(`${col}, created_at`));
  return error ? [] : ((data || []) as any[]);
}

function summaryLine(stats: Stat[], label: string) {
  const v = (l: string) => stats.find((x) => x.label === l);
  const parts = [['새 회원', '명'], ['매칭 제안', '건'], ['만남 성사', '쌍'], ['커플', '쌍']]
    .map(([l, u]) => { const x = v(l); return x ? `${l === '만남 성사' ? '만남' : l} ${x.cur}${u}${x.cur > x.prev ? '↑' : x.cur < x.prev ? '↓' : ''}` : null; })
    .filter(Boolean);
  return `${label === '오늘' ? '오늘' : `최근 ${label}`}: ${parts.join(' · ')}`;
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [totals, setTotals] = useState<{ members: number; partners: number } | null>(null);
  const [todo, setTodo] = useState<{ approvals: number; withdrawals: number; refunds: number; reports: number; reportsDue: number } | null>(null);
  const [idle, setIdle] = useState<Idle[] | null>(null);
  const [showAllIdle, setShowAllIdle] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const load = useCallback(async () => {
    if (user?.role !== 'operator') return;
    const { start, end, prevStart } = ranges(period);
    const within = (col: string, a: string, b: string) => (q: any) => q.gte(col, a).lt(col, b);
    const pair = async (table: string, col: string, extra: (q: any) => any = (q) => q) =>
      Promise.all([count(table, (q) => within(col, start, end)(extra(q))), count(table, (q) => within(col, prevStart, start)(extra(q)))]);

    const pairOrNull = async (table: string, col: string, extra: (q: any) => any = (q) => q) => {
      const r = await Promise.all([countOrNull(table, (q) => within(col, start, end)(extra(q))), countOrNull(table, (q) => within(col, prevStart, start)(extra(q)))]);
      return r[0] === null || r[1] === null ? null : (r as [number, number]);
    };
    const [couples, leaves] = await Promise.all([
      pairOrNull('match_requests', 'couple_at'),
      pair('users', 'withdrawn_at', (q) => q.in('role', ['hopeful', 'connector'])),
    ]);
    const [signups, partnerApps, proposals, meetings, charges, fees] = await Promise.all([
      pair('users', 'created_at', (q) => q.eq('role', 'hopeful')),
      pair('connectors', 'created_at'),
      pair('match_requests', 'created_at'),
      pair('match_requests', 'meeting_completed_at', (q) => q.eq('meeting_status', 'completed').or('closed_reason.is.null,closed_reason.neq.no_show')),
      sum('wallet_charges', 'amount', (q) => q.eq('status', 'paid').gte('created_at', prevStart)),
      sum('settlements', 'platform_fee', (q) => q.gte('created_at', prevStart)),
    ]);
    const split = (rows: any[], col: string) => [
      rows.filter((r) => r.created_at >= start).reduce((n, r) => n + Number(r[col] || 0), 0),
      rows.filter((r) => r.created_at < start).reduce((n, r) => n + Number(r[col] || 0), 0),
    ];
    const [chargeCur, chargePrev] = split(charges, 'amount');
    const [feeCur, feePrev] = split(fees, 'platform_fee');
    setStats([
      { label: '새 회원', cur: signups[0], prev: signups[1], fmt: (n) => `${n}명` },
      { label: '파트너 신청', cur: partnerApps[0], prev: partnerApps[1], fmt: (n) => `${n}명` },
      { label: '매칭 제안', cur: proposals[0], prev: proposals[1], fmt: (n) => `${n}건` },
      { label: '만남 성사', cur: meetings[0], prev: meetings[1], fmt: (n) => `${n}쌍` },
      ...(couples ? [{ label: '커플', cur: couples[0], prev: couples[1], fmt: (n: number) => `${n}쌍` }] : []),
      { label: '탈퇴', cur: leaves[0], prev: leaves[1], fmt: (n) => `${n}명`, bad: true },
      { label: '충전 금액', cur: chargeCur, prev: chargePrev, fmt: won },
      { label: '수수료 수익', cur: feeCur, prev: feePrev, fmt: won },
    ]);
  }, [period, user?.role]);

  const loadFixed = useCallback(async () => {
    if (user?.role !== 'operator') return;
    const [members, partners, approvals, withdrawals, refunds, reports] = await Promise.all([
      count('users', (q) => q.eq('role', 'hopeful').is('withdrawn_at', null)),
      count('connectors', (q) => q.eq('status', 'approved')),
      count('connectors', (q) => q.eq('status', 'pending')),
      count('withdrawal_requests', (q) => q.eq('status', 'pending')),
      count('refund_requests', (q) => q.eq('status', 'pending')),
      supabase.from('user_reports').select('created_at').eq('status', 'open').then(({ data }) => (data || []) as { created_at: string }[]),
    ]);
    setTotals({ members, partners });
    // 접수 20시간이 지난 신고 (24시간 안에 처리해야 함)
    const reportsDue = reports.filter((r) => reportDeadline(r.created_at).level !== 'ok').length;
    setTodo({ approvals, withdrawals, refunds, reports: reports.length, reportsDue });

    // 30일 동안 매칭 제안이 없는 파트너 (탈퇴·정지 제외, 오래 쉰 순)
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data: conns }, { data: recent }] = await Promise.all([
      supabase.from('connectors').select('id, business_name, created_at').eq('status', 'approved'),
      supabase.from('match_requests').select('connector_1_id, connector_2_id, created_at').gte('created_at', since),
    ]);
    const active = new Set<string>();
    for (const m of (recent || []) as any[]) { active.add(m.connector_1_id); active.add(m.connector_2_id); }
    const idleConns = ((conns || []) as any[]).filter((c) => !active.has(c.id));
    if (!idleConns.length) { setIdle([]); return; }
    const ids = idleConns.map((c) => c.id);
    const [{ data: users }, { data: last1 }, { data: last2 }] = await Promise.all([
      supabase.from('users').select('id, name, withdrawn_at, suspended_at').in('id', ids),
      supabase.from('match_requests').select('connector_1_id, created_at').in('connector_1_id', ids).order('created_at', { ascending: false }),
      supabase.from('match_requests').select('connector_2_id, created_at').in('connector_2_id', ids).order('created_at', { ascending: false }),
    ]);
    const lastAt = new Map<string, string>();
    for (const r of [...((last1 || []) as any[]).map((x) => [x.connector_1_id, x.created_at]), ...((last2 || []) as any[]).map((x) => [x.connector_2_id, x.created_at])] as [string, string][]) {
      if (!lastAt.has(r[0]) || lastAt.get(r[0])! < r[1]) lastAt.set(r[0], r[1]);
    }
    const byId = new Map(((users || []) as any[]).map((u) => [u.id, u]));
    const list = idleConns
      .filter((c) => { const u = byId.get(c.id); return u && !u.withdrawn_at && !u.suspended_at; })
      .map((c) => {
        const since0 = lastAt.get(c.id) || c.created_at;
        return { id: c.id, name: c.business_name || byId.get(c.id)?.name || '파트너', days: Math.max(0, Math.floor((Date.now() - new Date(since0).getTime()) / 86400000)), never: !lastAt.has(c.id) };
      })
      .sort((a, b) => b.days - a.days);
    setIdle(list as any);
  }, [user?.role]);

  useEffect(() => { setStats(null); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); loadFixed(); }, [load, loadFixed]));
  const pullRefresh = usePullRefresh(async () => { await Promise.all([load(), loadFixed()]); });

  if (user && user.role !== 'operator') return <Redirect href="/home" />;

  const prevLabel = PERIODS.find((p) => p[0] === period)![2];
  const delta = (s: Stat) => {
    const d = s.cur - s.prev;
    if (d === 0) return `${prevLabel}과 같아요`;
    return `${prevLabel}보다 ${d > 0 ? '+' : '−'}${(s.fmt || String)(Math.abs(d))}`;
  };
  const todoRows: [string, number, string][] = todo ? [
    ['파트너 승인', todo.approvals, 'approvals'],
    ['출금 요청', todo.withdrawals, 'withdrawals'],
    ['환불 요청', todo.refunds, 'refunds'],
    ['신고', todo.reports, 'reports'],
  ] : [];
  const todoTotal = todoRows.reduce((n, r) => n + r[1], 0);
  const shownIdle = idle ? (showAllIdle ? idle : idle.slice(0, 5)) : [];

  return (
    <ScrollView style={s.page} contentContainerStyle={{ paddingBottom: 40 }} refreshControl={pullRefresh}>
      <View style={s.header}>
        <Text style={s.title}>현황</Text>
        <NotificationBell />
      </View>

      {/* 전체 규모 */}
      <View style={s.totals}>
        <View style={s.totalBox}>
          <Text style={s.totalLabel}>전체 회원</Text>
          <Text style={s.totalValue}>{totals ? `${totals.members.toLocaleString()}명` : '–'}</Text>
        </View>
        <View style={s.totalBox}>
          <Text style={s.totalLabel}>활동 파트너</Text>
          <Text style={s.totalValue}>{totals ? `${totals.partners.toLocaleString()}명` : '–'}</Text>
        </View>
      </View>

      <TouchableOpacity style={s.noticeBtn} onPress={() => setNoticeOpen(true)} accessibilityLabel="공지 보내기">
        <Text style={s.noticeBtnT}>📢 전체 공지 보내기</Text>
        <Text style={s.noticeBtnSub}>회원·파트너에게 알림으로 ›</Text>
      </TouchableOpacity>
      <UserLookupRow style={s.lookupRow} />
      <BackupReminder style={s.lookupRow} />

      {/* 지금 처리할 일 */}
      <Text style={s.h2}>지금 처리할 일 {todo ? <Text style={todoTotal ? s.h2Count : s.h2Zero}>{todoTotal ? `${todoTotal}건` : '없어요'}</Text> : null}</Text>
      <View style={s.card}>
        {!todo ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 12 }} /> : todoRows.map(([label, n, seg]) => (
          <TouchableOpacity key={seg} style={s.todoRow} onPress={() => router.push({ pathname: '/settlements', params: { segment: seg } })} accessibilityLabel={`${label} ${n}건`}>
            <Text style={s.todoLabel}>{label}</Text>
            {seg === 'reports' && todo.reportsDue > 0 && <Text style={s.todoDue}>⏰ 기한 임박 {todo.reportsDue}건</Text>}
            <Text style={[s.todoN, n > 0 && s.todoNOn]}>{n}건 ›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FeedbackInbox />

      {/* 기간별 숫자 */}
      <View style={s.periodRow}>
        {PERIODS.map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.periodChip, period === key && s.periodChipOn]} onPress={() => setPeriod(key)} accessibilityLabel={`기간 ${label}`} accessibilityState={{ selected: period === key }}>
            <Text style={[s.periodText, period === key && s.periodTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!stats ? (
        <ActivityIndicator color="#5B21FF" style={{ marginVertical: 40 }} />
      ) : (
        <View style={s.grid}>
          {/* 한 줄 요약: 이 기간의 핵심 결과 */}
          <Text style={s.summary} accessibilityLabel="기간 요약">{summaryLine(stats, PERIODS.find((p) => p[0] === period)![1])}</Text>
          {stats.map((st) => (
            <View key={st.label} style={s.tile} accessibilityLabel={`${st.label} ${(st.fmt || String)(st.cur)}`}>
              <Text style={s.tileLabel}>{st.label}</Text>
              <Text style={s.tileValue}>{(st.fmt || String)(st.cur)}</Text>
              <Text style={[s.tileSub, st.cur > st.prev && !st.bad && s.tileUp]}>{delta(st)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 쉬고 있는 파트너 */}
      <Text style={s.h2}>30일 동안 제안이 없는 파트너 {idle ? <Text style={s.h2Zero}>{idle.length}명</Text> : null}</Text>
      <View style={s.card}>
        {!idle ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 12 }} /> : idle.length === 0 ? (
          <Text style={s.empty}>모든 파트너가 최근 30일 안에 매칭을 제안했어요 👍</Text>
        ) : (
          <>
            {shownIdle.map((p: any) => (
              <View key={p.id} style={s.idleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.idleName}>{p.name}</Text>
                  <Text style={s.idleSub}>{p.never ? `가입 ${p.days}일 · 아직 제안 없음` : `마지막 제안 ${p.days}일 전`}</Text>
                </View>
                <TouchableOpacity style={s.chatBtn} onPress={() => router.push({ pathname: '/chat', params: { with: p.id, name: p.name } })} accessibilityLabel={`${p.name} 파트너와 채팅`}>
                  <Text style={s.chatBtnT}>💬 연락</Text>
                </TouchableOpacity>
              </View>
            ))}
            {idle.length > 5 && (
              <TouchableOpacity onPress={() => setShowAllIdle(!showAllIdle)} style={{ paddingTop: 10 }}>
                <Text style={s.more}>{showAllIdle ? '접기' : `${idle.length - 5}명 더 보기`}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
      <NoticeComposer visible={noticeOpen} onClose={() => setNoticeOpen(false)} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#322F38' },
  totals: { flexDirection: 'row', gap: 10, marginHorizontal: 20 },
  totalBox: { flex: 1, backgroundColor: '#5B21FF', borderRadius: 16, padding: 16 },
  totalLabel: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  totalValue: { fontSize: 24, fontWeight: '800', color: '#fff', marginTop: 4 },
  lookupRow: { marginHorizontal: 20, marginTop: 10 },
  noticeBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E4D9FF', backgroundColor: '#F5F1FF' },
  noticeBtnT: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  noticeBtnSub: { fontSize: 12, color: '#5B21FF', fontWeight: '600' },
  h2: { fontSize: 15, fontWeight: '700', color: '#322F38', marginHorizontal: 20, marginTop: 24, marginBottom: 8 },
  h2Count: { color: '#5B21FF' },
  h2Zero: { color: '#98959E', fontWeight: '400', fontSize: 13 },
  card: { marginHorizontal: 20, borderWidth: 1, borderColor: '#EFEDF2', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  todoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F3F8' },
  todoLabel: { fontSize: 14, color: '#322F38' },
  todoDue: { fontSize: 12, color: '#E5484D', fontWeight: '700', marginLeft: 'auto', marginRight: 8 },
  todoN: { fontSize: 14, color: '#98959E' },
  todoNOn: { color: '#5B21FF', fontWeight: '700' },
  periodRow: { flexDirection: 'row', gap: 8, marginHorizontal: 20, marginTop: 24, marginBottom: 10 },
  periodChip: { paddingHorizontal: 16, height: 34, borderRadius: 999, borderWidth: 1, borderColor: '#DCD9E2', justifyContent: 'center' },
  periodChipOn: { borderColor: '#5B21FF', backgroundColor: '#F5F1FF' },
  periodText: { fontSize: 13, color: '#65626B', fontWeight: '600' },
  periodTextOn: { color: '#5B21FF' },
  summary: { width: '100%', fontSize: 14, fontWeight: '700', color: '#322F38', marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginHorizontal: 20 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: '#F8F7FA', borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 12, color: '#87848D' },
  tileValue: { fontSize: 22, fontWeight: '800', color: '#322F38', marginTop: 4 },
  tileSub: { fontSize: 11, color: '#98959E', marginTop: 4 },
  tileUp: { color: '#5B21FF' },
  empty: { fontSize: 13, color: '#87848D', paddingVertical: 12 },
  idleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F5F3F8', gap: 10 },
  idleName: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  idleSub: { fontSize: 12, color: '#87848D', marginTop: 2 },
  chatBtn: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 999, paddingHorizontal: 12, height: 32, justifyContent: 'center' },
  chatBtnT: { fontSize: 12, color: '#322F38', fontWeight: '600' },
  more: { fontSize: 13, color: '#5B21FF', fontWeight: '600', textAlign: 'center', paddingBottom: 6 },
});
