import React, { useState, useEffect, useRef } from 'react';
import SkeletonScreen from '@/components/Skeleton';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusPolling } from '@/hooks/use-focus-polling';
import { FILTER_LABEL, FILTERS, MatchFilter, membersPickedDates, noShowReporter, passesFilter } from '@/lib/matchStage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getCredit } from '@/lib/payments';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';
import DatePickerSheet from '@/components/DatePickerSheet';
import { useMemberFilter } from '@/components/MemberFilter';
import MemberProfileView, { MemberProfile } from '@/components/MemberProfileView';
import { formatMeetingDate } from '@/lib/format';
import { earliestCommonDate, sendContactsViaChat } from '@/lib/schedule';
import BottomSheet from '@/components/BottomSheet';
import { Avatar } from '@/components/ProfilePhoto';
import { AFTER_CARE_DAYS, afterCareDeadline, expireAfterCareIfDue, formatDeadline } from '@/lib/afterCare';


// 매칭 후보로 고를 회원 (사진·나이·지역을 보고 고른다)
type Member = MemberProfile & { id: string; name: string };
const MEMBER_FIELDS = 'id, name, gender, age, birth_date, location, photo_urls, height, job, education, bio, religion, smoking, drinking, body_type, suspended_at';
// 이용 정지된 회원은 매칭 후보에서 뺀다
const active = (users: any[] | null) => ((users || []) as any[]).filter((u) => !u.suspended_at) as Member[];

function memberSummary(m: Member) {
  return [m.gender === 'M' ? '남' : m.gender === 'F' ? '여' : null, m.age && `${m.age}세`, m.location].filter(Boolean).join(' · ');
}

export default function MatchingScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [matchRequests, setMatchRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // 일정 선택 시트를 연 매칭 id
  const [scheduleMatchId, setScheduleMatchId] = useState<string | null>(null);
  // 애프터 응답 요청 알림을 보낸 '매칭id:회원id'
  const [remindedKeys, setRemindedKeys] = useState<string[]>([]);
  // 동맹 파트너 회원까지 후보로 보여줄지
  const [includeAllies, setIncludeAllies] = useState(false);
  // 매칭(제안·진행 중) / 매칭내역(마무리된 매칭)
  const [view, setView] = useState<'active' | 'history'>('active');
  // 회원 후보 필터 (회원 탭과 같은 필터)
  const memberFilter = useMemberFilter();
  // 회원별 최근 매칭 제안 날짜 · 진행 중 여부 (오래 쉰 회원을 먼저 찾기 위해)
  const [lastMatch, setLastMatch] = useState<Record<string, { at: string; active: boolean }>>({});
  // 두 회원이 예전에 엮였던 기록 ('작은id|큰id' → 이미 만남 / 지난번 거절)
  const [pairHistory, setPairHistory] = useState<Record<string, 'met' | 'rejected'>>({});
  // 회원별 남은 이용권 (회원의 담당 파트너 기준). 불러오기 전에는 비어 있어 막지 않는다
  const [credits, setCredits] = useState<Record<string, number> | null>(null);
  const router = useRouter();
  // 알림에서 들어오면 해당 칸(예: 동맹매칭)을 바로 연다
  // 동맹 매칭 알림으로 들어오면 동맹 회원까지 펼쳐서 보여준다
  const params = useLocalSearchParams<{ segment?: string; view?: string; focus?: string; stage?: string; pick?: string; pickFrom?: string }>();
  // 홈의 단계 묶음에서 들어오면 그 단계만 걸러 본다 (null = 전체)
  const [stageFilter, setStageFilter] = useState<MatchFilter | null>(null);
  // 홈 카드에서 들어오면 그 매칭 카드로 스크롤하고 잠깐 강조한다
  const [focusId, setFocusId] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const historyOrderRef = useRef<string[]>([]);
  const scrollRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (scrollRetryRef.current) clearTimeout(scrollRetryRef.current); }, []);
  // 강조할 매칭이 목록에 나타나면 그 위치로 스크롤하고, 잠시 뒤 강조를 끈다
  useEffect(() => {
    if (!focusId || view !== 'history') return;
    const index = historyOrderRef.current.indexOf(focusId);
    if (index < 0) return;
    const t1 = setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 }), 300);
    const t2 = setTimeout(() => setFocusId(null), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [focusId, view, matchRequests.length]);

  // 회원 탭 '이 회원으로 매칭 제안하기': 그 회원을 골라 둔 채 매칭 제안 화면을 연다
  useEffect(() => {
    if (!params.pick || !user) return;
    const from = params.pickFrom || user.id;
    setView('active');
    setStageFilter(null);
    if (from !== user.id) setIncludeAllies(true);
    setSelectedForMatch([{ id: params.pick, connectorId: from }]);
    router.setParams({ pick: undefined, pickFrom: undefined });
  }, [params.pick, params.pickFrom, user?.id]);

  useEffect(() => {
    if (params.view === 'active') {
      setView('active');
      router.setParams({ view: undefined });
    } else if (params.segment === 'ally' || params.view === 'history' || params.focus) {
      // 매칭 관련 알림(동의 요청, 승인, 일정 등)은 매칭내역에서 확인한다
      setView('history');
      if (params.focus) setFocusId(params.focus);
      setStageFilter(params.stage && (FILTERS as string[]).includes(params.stage) ? (params.stage as MatchFilter) : null);
      router.setParams({ segment: undefined, view: undefined, focus: undefined, stage: undefined });
    }
  }, [params.segment, params.view, params.focus, params.stage]);

  const [ownMembers, setOwnMembers] = useState<Member[]>([]);
  const [allyMembersForRest, setAllyMembersForRest] = useState<string[]>([]);
  const [allyConnectors, setAllyConnectors] = useState<{ id: string; name: string }[]>([]);
  // 동맹 파트너별 회원 (동맹 회원 포함을 켰을 때 후보)
  const [allyMembers, setAllyMembers] = useState<{ connector: { id: string; name: string }; members: Member[] }[]>([]);
  // 프로필을 크게 보고 있는 후보 회원
  const [previewMember, setPreviewMember] = useState<{ member: Member; connectorId: string } | null>(null);
  // 매칭내역에서 두 회원 프로필 보기 (동의 전 확인용)
  const [viewMember, setViewMember] = useState<{ member: any; partner?: string } | null>(null);
  const [selectedForMatch, setSelectedForMatch] = useState<{ id: string; connectorId: string }[]>([]);
  const [proposing, setProposing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchMatches();
      fetchOwnMembers();
      fetchAllyConnectors();
    }
  }, [user]);

  useFocusPolling(() => {
    fetchMatches();
    fetchOwnMembers();
    fetchAllyConnectors();
  }, 15000, !!user);
  const pullRefresh = usePullRefresh(() => Promise.all([fetchMatches(), fetchOwnMembers(), fetchAllyConnectors()]));

  async function fetchMatches(retried = false) {
    try {
      if (user?.role === 'connector') {
        let matchData: any[] = [];

        const { data: myProposals } = await supabase
          .from('match_requests')
          .select('*')
          .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
          .in('status', ['pending', 'approved', 'completed']);

        // 내가 담당하는 매칭만 (내 회원이 다른 파트너의 매칭에 들어 있어도 그 매칭은 그 파트너가 관리한다)
        matchData = [...(myProposals || [])];

        // 애프터 응답 기한이 지난 매칭은 자동으로 마무리하고 다시 불러온다
        const expired = await Promise.all(matchData.map((m: any) => expireAfterCareIfDue(m)));
        if (expired.some(Boolean) && !retried) return fetchMatches(true);

        // 최신 매칭이 위로 오도록 정렬
        matchData.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // 동맹 매칭의 연결자 이름 (누구의 동의를 기다리는지 표시)
        const connectorIds = [...new Set(matchData.flatMap((m: any) => [m.connector_1_id, m.connector_2_id]))];
        const { data: connectorUsers } = await supabase
          .from('users')
          .select('id, name')
          .in('id', connectorIds.length ? connectorIds : ['00000000-0000-0000-0000-000000000000']);
        const connectorName = (id: string) => (connectorUsers || []).find((u: any) => u.id === id)?.name || '상대 파트너';

        // 희望자 정보 조회
        const hopefulUserIds = matchData.flatMap((m: any) => [m.hopeful_1_id, m.hopeful_2_id]);
        const { data: hopefulUsers } = await supabase
          .from('users')
          .select('*')
          .in('id', hopefulUserIds);

        // 매칭 데이터 구성
        const matches = matchData.map((m: any) => {
          const hopeful1 = (hopefulUsers || []).find((h: any) => h.id === m.hopeful_1_id);
          const hopeful2 = (hopefulUsers || []).find((h: any) => h.id === m.hopeful_2_id);
          return {
            id: m.id,
            hopeful_1: hopeful1,
            hopeful_2: hopeful2,
            hopeful_1_approved: m.hopeful_1_approved,
            hopeful_2_approved: m.hopeful_2_approved,
            meeting_status: m.meeting_status,
            after_care_hopeful_1: m.after_care_hopeful_1,
            after_care_hopeful_2: m.after_care_hopeful_2,
            settlement_completed: m.settlement_completed,
            status: m.status,
            created_at: m.created_at,
            connector_1_id: m.connector_1_id,
            connector_2_id: m.connector_2_id,
            connector_1_consented: m.connector_1_consented,
            connector_2_consented: m.connector_2_consented,
            proposer_connector_id: m.proposer_connector_id,
            connector_1_name: connectorName(m.connector_1_id),
            connector_2_name: connectorName(m.connector_2_id),
            meeting_scheduled_at: m.meeting_scheduled_at,
            meeting_completed_at: m.meeting_completed_at,
            meeting_done_connector_1: m.meeting_done_connector_1,
            meeting_done_connector_2: m.meeting_done_connector_2,
            closed_reason: m.closed_reason,
            available_dates_1: m.available_dates_1,
            available_dates_2: m.available_dates_2,
          };
        });

        setMatchRequests(matches);
      }
    } catch (error) {
      console.error('Error fetching matches:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchOwnMembers() {
    if (!user) return;
    const { data } = await supabase
      .from('hopeful_requests')
      .select('hopeful_id')
      .eq('connector_id', user.id)
      .eq('status', 'approved');
    const ids = (data || []).map((r: any) => r.hopeful_id);
    if (ids.length === 0) {
      setOwnMembers([]);
      return;
    }
    const { data: users } = await supabase.from('users').select(MEMBER_FIELDS).in('id', ids);
    setOwnMembers(active(users));
  }

  async function fetchAllyConnectors() {
    if (!user) return;
    const { data: allianceRows } = await supabase
      .from('connector_alliances')
      .select('*')
      .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
      .eq('status', 'ACTIVE');
    const allyIds = (allianceRows || []).map((a: any) =>
      a.connector_1_id === user.id ? a.connector_2_id : a.connector_1_id
    );
    if (allyIds.length === 0) {
      setAllyConnectors([]);
      setAllyMembers([]);
      return;
    }
    const { data: users } = await supabase.from('users').select('id, name').in('id', allyIds);
    const allies = (users || []).map((u: any) => ({ id: u.id, name: u.name }));
    setAllyConnectors(allies);
    await fetchAllyMembers(allies);
  }

  async function fetchAllyMembers(allies: { id: string; name: string }[]) {
    const groups = await Promise.all(allies.map(async (conn) => {
      const { data } = await supabase
        .from('hopeful_requests')
        .select('hopeful_id')
        .eq('connector_id', conn.id)
        .eq('status', 'approved');
      const ids = (data || []).map((r: any) => r.hopeful_id);
      if (ids.length === 0) return { connector: conn, members: [] as Member[] };
      const { data: users } = await supabase.from('users').select(MEMBER_FIELDS).in('id', ids);
      return { connector: conn, members: active(users) };
    }));
    setAllyMembers(groups);
    setAllyMembersForRest(groups.flatMap((g: any) => g.members.map((m: any) => m.id)));
  }

  useEffect(() => {
    const ids = [...ownMembers.map((m) => m.id), ...allyMembersForRest];
    if (!ids.length) return;
    (async () => {
      const cols = 'hopeful_1_id, hopeful_2_id, created_at, status, settlement_completed';
      const [a, b, pay] = await Promise.all([
        supabase.from('match_requests').select(cols).in('hopeful_1_id', ids),
        supabase.from('match_requests').select(cols).in('hopeful_2_id', ids),
        supabase.from('payments').select('hopeful_id, connector_id, sessions_remaining').eq('status', 'paid').in('hopeful_id', ids),
      ]);
      // 만남중 회원은 따로 막으므로, 남은 이용권은 담당 파트너에게 산 이용권의 남은 횟수로 충분하다
      if (!pay.error) {
        const partnerOf: Record<string, string> = {};
        for (const m of ownMembers) partnerOf[m.id] = user?.id || '';
        for (const g of allyMembers) for (const m of g.members) partnerOf[m.id] = g.connector.id;
        const cr: Record<string, number> = {};
        for (const id of ids) cr[id] = 0;
        for (const r of (pay.data || []) as any[]) if (partnerOf[r.hopeful_id] === r.connector_id) cr[r.hopeful_id] += Number(r.sessions_remaining) || 0;
        setCredits(cr);
      }
      const pairs: Record<string, 'met' | 'rejected'> = {};
      const map: Record<string, { at: string; active: boolean }> = {};
      for (const m of [...(a.data || []), ...(b.data || [])] as any[]) {
        const active = m.status !== 'rejected' && !m.settlement_completed;
        const pk = [m.hopeful_1_id, m.hopeful_2_id].sort().join('|');
        if (m.settlement_completed) pairs[pk] = 'met';
        else if (m.status === 'rejected' && pairs[pk] !== 'met') pairs[pk] = 'rejected';
        for (const id of [m.hopeful_1_id, m.hopeful_2_id]) {
          if (!ids.includes(id)) continue;
          const cur = map[id];
          map[id] = { at: !cur || m.created_at > cur.at ? m.created_at : cur.at, active: (cur?.active || false) || active };
        }
      }
      setLastMatch(map);
      setPairHistory(pairs);
    })();
  }, [ownMembers, allyMembersForRest, matchRequests.length]);

  // 회원 탭에서 골라 온 회원이 만남중이거나 이용권이 없으면 선택을 풀고 알려준다
  useEffect(() => {
    const bad = selectedForMatch.find((x) => lastMatch[x.id]?.active || credits?.[x.id] === 0);
    if (!bad) return;
    setSelectedForMatch(selectedForMatch.filter((x) => x.id !== bad.id));
    toast.show(BLOCK_MESSAGE[lastMatch[bad.id]?.active ? '만남중' : '이용권 없음'], 'info');
  }, [lastMatch, credits]);

  // 지금 고를 수 없는 이유 (없으면 null). 같은 성별·동맹끼리는 한 명을 고른 뒤에만 따진다
  function blockReason(id: string, connectorId: string): BlockLabel | null {
    if (selectedForMatch.some((x) => x.id === id)) return null;
    if (lastMatch[id]?.active) return '만남중';
    const first = selectedForMatch.length === 1 ? selectedForMatch[0] : null;
    if (first) {
      const all = [...ownMembers, ...allyMembers.flatMap((g) => g.members)];
      const g1 = all.find((m) => m.id === first.id)?.gender, g2 = all.find((m) => m.id === id)?.gender;
      if (g1 && g2 && g1 === g2) return '같은 성별';
      if (connectorId !== user?.id && first.connectorId !== user?.id) return '내 회원과만 가능';
    }
    // 이용권은 맨 마지막에 본다 (눌렀을 때 다시 확인해서 고를 수 있게 하므로)
    if (credits && credits[id] === 0) return '이용권 없음';
    return null;
  }

  // 고를 수는 있지만 알아두면 좋은 것: 먼저 고른 회원과 예전에 엮였던 사이
  function pairHint(id: string) {
    const first = selectedForMatch.length === 1 ? selectedForMatch[0] : null;
    if (!first || first.id === id) return null;
    const h = pairHistory[[first.id, id].sort().join('|')];
    return h === 'met' ? '이미 만남' : h === 'rejected' ? '지난번 거절' : null;
  }

  function restLabel(id: string) {
    const lm = lastMatch[id];
    if (!lm) return '매칭 이력 없음';
    if (lm.active) return '만남중';
    const days = Math.max(0, Math.floor((Date.now() - new Date(lm.at).getTime()) / 86400000));
    return days === 0 ? '오늘 매칭 제안' : `최근 매칭 ${days}일 전`;
  }

  function toggleSelectForMatch(memberId: string, connectorId: string) {
    // 안내는 상태 업데이트 함수 밖에서 (개발 모드에서 두 번 뜨지 않도록)
    const prev = selectedForMatch;
    if (prev.some((s) => s.id === memberId)) {
      setSelectedForMatch(prev.filter((s) => s.id !== memberId));
      return;
    }
    const block = blockReason(memberId, connectorId);
    // 화면을 연 뒤에 회원이 이용권을 샀을 수 있으니 '이용권 없음'은 눌렀을 때 한 번 더 확인한다
    if (block === '이용권 없음') {
      getCredit(memberId, connectorId).then(({ credit, error }) => {
        if (error || credit <= 0) return toast.show(BLOCK_MESSAGE[block], 'info');
        setCredits((c) => ({ ...(c || {}), [memberId]: credit }));
        setSelectedForMatch((cur) => (cur.length >= 2 || cur.some((x) => x.id === memberId) ? cur : [...cur, { id: memberId, connectorId }]));
      });
      return;
    }
    if (block) {
      toast.show(BLOCK_MESSAGE[block], 'info');
      return;
    }
    if (prev.length >= 2) {
      toast.show('최대 2명까지 선택할 수 있습니다', 'error');
      return;
    }
    // 동맹 회원끼리는 매칭할 수 없다 (내 회원이 한 명은 있어야 한다)
    if (prev.length === 1 && connectorId !== user?.id && prev[0].connectorId !== user?.id) {
      toast.show('동맹 회원끼리는 매칭할 수 없어요. 내 회원을 한 명 포함해주세요', 'error');
      return;
    }
    setSelectedForMatch([...prev, { id: memberId, connectorId }]);
  }

  function memberName(id: string) {
    return [...ownMembers, ...allyMembers.flatMap((g) => g.members)].find((m) => m.id === id)?.name ?? '회원';
  }

  async function handleProposeMatch() {
    if (!user || selectedForMatch.length !== 2 || proposing) return;

    setProposing(true);
    try {
      const [a, b] = selectedForMatch;
      // 이용권(진행 중 매칭에 묶인 것 제외)·동맹·중복 확인과 저장을 서버에서 한 번에 처리한다
      const { data: result, error } = await supabase.rpc('fn_propose_match', {
        p_proposer_id: user.id,
        p_hopeful_1: a.id,
        p_connector_1: a.connectorId,
        p_hopeful_2: b.id,
        p_connector_2: b.connectorId,
      });
      if (error?.message?.includes('SUSPENDED_USER')) {
        toast.show('이용이 정지된 회원이 있어 매칭할 수 없어요', 'error');
        return;
      }
      if (error?.message?.includes('BLOCKED_PAIR')) {
        // 어느 쪽이 차단했는지는 파트너에게 알리지 않는다
        toast.show('두 회원은 서로 매칭할 수 없어요', 'error');
        return;
      }
      if (error || !result) throw error;
      if (!result.ok) {
        const messages: Record<string, string> = {
          no_credit: `${memberName(result.hopeful_id)}님은 새 매칭에 쓸 이용권이 없어요 (진행 중인 매칭에 쓰이는 이용권은 제외돼요)`,
          duplicate: '두 회원은 이미 진행 중인 매칭이 있어요',
          not_your_member: '내 회원을 한 명 이상 포함해서 제안해주세요',
          no_alliance: '동맹이 활성화된 파트너의 회원만 매칭할 수 있어요',
          not_member: '가입이 승인된 회원만 매칭할 수 있어요',
          same_member: '서로 다른 두 회원을 선택해주세요',
        };
        toast.show(messages[result.reason] ?? '매칭을 제안하지 못했어요', 'error');
        return;
      }

      if (result.needs_consent) {
        // 상대 파트너의 동의가 필요하다는 것을 알린다
        await createNotification({
          userId: a.connectorId === user.id ? b.connectorId : a.connectorId,
          type: 'match_consent_requested',
          title: '동맹 매칭 동의 요청이 왔습니다',
          body: `${user.name}님이 회원 매칭을 제안했습니다. 매칭 › 매칭내역에서 확인해주세요`,
          route: '/matching',
          routeParams: { segment: 'ally' },
        });
      } else {
        await Promise.all([
          createNotification({ userId: a.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
          createNotification({ userId: b.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
        ]);
      }

      toast.show('✓ 매칭을 제안했습니다. 매칭내역에서 진행 상황을 볼 수 있어요', 'success');
      setSelectedForMatch([]);
      setView('history');
      fetchMatches();
    } catch (error: any) {
      console.error('propose error:', error);
      toast.show('매칭 제안 중 오류가 발생했습니다', 'error');
    } finally {
      setProposing(false);
    }
  }

  async function handleConsentApprove(matchId: string) {
    if (!user) return;
    const match = matchRequests.find(m => m.id === matchId);
    if (!match) return;

    setProcessingId(matchId);
    try {
      // 동맹·이용권 확인 후 동의를 저장한다 (그 사이 이용권을 다른 매칭에 썼을 수 있다)
      const { data: result, error } = await supabase.rpc('fn_consent_match', { p_match_id: matchId, p_connector_id: user.id });
      if (error?.message?.includes('BLOCKED_PAIR')) {
        // 어느 쪽이 차단했는지는 파트너에게 알리지 않는다
        toast.show('두 회원은 서로 매칭할 수 없어요', 'error');
        return;
      }
      if (error || !result) throw error;
      if (!result.ok) {
        const messages: Record<string, string> = {
          no_credit: '회원 중 새 매칭에 쓸 이용권이 없는 사람이 있어요. 매칭을 거절하거나 회원이 이용권을 구매한 뒤 동의해주세요',
          no_alliance: '동맹이 해지되어 동의할 수 없어요',
          closed: '이미 종료된 매칭이에요',
          not_needed: '이미 동의한 매칭이에요',
        };
        toast.show(messages[result.reason] ?? '동의하지 못했어요', 'error');
        await fetchMatches();
        return;
      }

      // 양쪽 동의가 끝났으면 회원들에게 제안을 알린다
      const { data: fresh } = await supabase
        .from('match_requests')
        .select('connector_1_consented, connector_2_consented')
        .eq('id', matchId)
        .single();
      if (fresh?.connector_1_consented && fresh?.connector_2_consented && match.hopeful_1?.id && match.hopeful_2?.id) {
        await Promise.all([
          createNotification({ userId: match.hopeful_1.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
          createNotification({ userId: match.hopeful_2.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
        ]);
      }

      // 제안한 상대 파트너에게 동의 사실을 알린다
      const otherConnectorId = match.connector_1_id === user.id ? match.connector_2_id : match.connector_1_id;
      if (otherConnectorId && otherConnectorId !== user.id) {
        await createNotification({
          userId: otherConnectorId,
          type: 'match_consent_given',
          title: '동맹 매칭에 동의했습니다',
          body: `${user.name}님이 매칭에 동의해 회원들에게 제안이 전달되었습니다`,
          route: '/matching',
          routeParams: { segment: 'ally' },
        });
      }

      toast.show('✓ 매칭에 동의했습니다', 'success');
      await fetchMatches();
    } catch (error) {
      console.error('Error:', error);
      toast.show('동의 처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  // 만남 완료 전까지 담당 파트너는 매칭을 취소(동맹 매칭은 거절)할 수 있다. 묶여 있던 이용권은 풀린다
  // 회원의 노쇼 신고 확인: 맞으면 정산 없이 종료, 아니면 신고를 되돌리고 애프터 의사를 다시 묻는다
  async function handleNoShowDecision(item: any, confirmed: boolean) {
    const side = noShowReporter(item);
    if (!side || processingId) return;
    const ok = await confirm(confirmed
      ? { title: '노쇼로 종료할까요?', message: '정산 없이 매칭이 종료되고, 두 회원의 이용권은 차감되지 않아요.', confirmText: '노쇼로 종료', destructive: true }
      : { title: '만남이 있었던 것으로 할까요?', message: '신고가 취소되고, 신고한 회원에게 애프터 의사를 다시 골라 달라고 알려요.', confirmText: '신고 반려' });
    if (!ok) return;
    const reporterId = (side === 1 ? item.hopeful_1 : item.hopeful_2)?.id;
    const otherId = (side === 1 ? item.hopeful_2 : item.hopeful_1)?.id;
    setProcessingId(item.id);
    try {
      if (confirmed) {
        const { data: closed, error } = await supabase.rpc('fn_settle_match', { p_match_id: item.id });
        if (error) throw error;
        if (closed) {
          await Promise.all([
            createNotification({ userId: reporterId, type: 'no_show_confirmed', title: '노쇼 신고가 확인되었어요', body: '매칭이 종료되었고 이용권은 차감되지 않았어요', route: '/home' }),
            createNotification({ userId: otherId, type: 'match_closed', title: '이번 소개는 종료되었어요', body: '이용권은 차감되지 않았어요', route: '/home' }),
          ]);
        }
        toast.show('노쇼로 종료했어요', 'success');
      } else {
        const col = side === 1 ? 'after_care_hopeful_1' : 'after_care_hopeful_2';
        const { error } = await supabase.from('match_requests')
          .update({ [col]: null, [side === 1 ? 'after_care_requested_at_1' : 'after_care_requested_at_2']: null })
          .eq('id', item.id).eq(col, '노쇼신고').eq('settlement_completed', false);
        if (error) throw error;
        await createNotification({ userId: reporterId, type: 'no_show_rejected', title: '만남이 있었던 것으로 확인됐어요', body: '파트너가 확인했어요. 홈에서 애프터 의사를 다시 골라 주세요', route: '/home' });
        toast.show('신고를 반려하고 회원에게 다시 물어봤어요', 'success');
      }
      await fetchMatches();
    } catch (e) {
      console.error('no-show decision error:', e);
      toast.show('처리하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleCancelMatch(matchId: string, isDecline: boolean) {
    if (!user) return;
    const match = matchRequests.find((m) => m.id === matchId);
    if (!match) return;
    const ok = await confirm({
      title: isDecline ? '이 동맹 매칭을 거절할까요?' : '매칭을 취소할까요?',
      message: isDecline
        ? '제안한 파트너에게 거절 사실이 전달됩니다.'
        : '두 회원과 상대 파트너에게 취소 사실이 전달되고 되돌릴 수 없습니다. 회원 이용권은 차감되지 않아요.',
      confirmText: isDecline ? '거절' : '매칭 취소',
      destructive: true,
    });
    if (!ok) return;

    setProcessingId(matchId);
    try {
      const { data: result, error } = await supabase.rpc('fn_cancel_match', { p_match_id: matchId, p_connector_id: user.id });
      if (error?.message?.includes('BLOCKED_PAIR')) {
        // 어느 쪽이 차단했는지는 파트너에게 알리지 않는다
        toast.show('두 회원은 서로 매칭할 수 없어요', 'error');
        return;
      }
      if (error || !result) throw error;
      if (!result.ok) {
        toast.show(
          result.reason === 'meeting_done' ? '만남이 끝난 매칭은 취소할 수 없어요'
            : result.reason === 'not_yours' ? '내가 담당하는 매칭만 취소할 수 있어요'
            : '이미 종료된 매칭이에요',
          'error'
        );
        await fetchMatches();
        return;
      }
      const crossConnector = match.connector_1_id !== match.connector_2_id;
      const otherConnectorId = match.connector_1_id === user.id ? match.connector_2_id : match.connector_1_id;
      const membersKnow = !crossConnector || (match.connector_1_consented && match.connector_2_consented);
      await Promise.all([
        ...(membersKnow
          ? [match.hopeful_1?.id, match.hopeful_2?.id].filter(Boolean).map((id: string) =>
              createNotification({ userId: id, type: 'match_cancelled', title: '매칭이 취소되었어요', body: '파트너 사정으로 이번 매칭이 취소되었어요. 이용권은 차감되지 않았어요', route: '/home' })
            )
          : []),
        crossConnector && otherConnectorId !== user.id
          ? createNotification({
              userId: otherConnectorId,
              type: 'match_cancelled',
              title: isDecline ? '동맹 매칭이 거절되었어요' : '동맹 매칭이 취소되었어요',
              body: `${user.name}님 · ${match.hopeful_1?.name} ↔ ${match.hopeful_2?.name}`,
              route: '/matching',
              routeParams: { segment: 'ally' },
            })
          : Promise.resolve(),
      ]);
      toast.show(isDecline ? '매칭을 거절했어요' : '매칭을 취소했어요', 'info');
      await fetchMatches();
    } catch (error) {
      console.error('cancel error:', error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSetSchedule(matchId: string, scheduledAt: Date) {
    setScheduleMatchId(null);
    setProcessingId(matchId);
    try {
      // 처음 정하는 날짜인지는 화면 값이 아니라 저장된 값으로 판단한다 (그 사이 자동으로 정해졌을 수 있다)
      const { data: firstSet, error } = await supabase
        .from('match_requests')
        .update({ meeting_scheduled_at: scheduledAt.toISOString() })
        .eq('id', matchId)
        .is('meeting_scheduled_at', null)
        .neq('status', 'rejected')
        .select('id');
      if (error) throw error;
      const isFirst = !!firstSet?.length;
      if (!isFirst) {
        // 날짜 변경: 어느 파트너든 만남 완료를 누른 뒤에는 바꿀 수 없다
        const { data: changed, error: changeError } = await supabase
          .from('match_requests')
          .update({ meeting_scheduled_at: scheduledAt.toISOString() })
          .eq('id', matchId)
          .eq('meeting_done_connector_1', false)
          .eq('meeting_done_connector_2', false)
          .neq('status', 'rejected')
          .select('id');
        if (changeError) throw changeError;
        if (!changed?.length) {
          toast.show('만남 완료가 이미 눌렸거나 종료된 매칭이라 날짜를 바꿀 수 없어요', 'error');
          await fetchMatches();
          return;
        }
      }

      const match = matchRequests.find((m) => m.id === matchId);
      // 처음 날짜를 정할 때만 연락처를 보낸다 (날짜 변경 시에는 다시 보내지 않음)
      if (match && isFirst && match.hopeful_1?.id && match.hopeful_2?.id) {
        await sendContactsViaChat({
          hopeful_1_id: match.hopeful_1.id,
          hopeful_2_id: match.hopeful_2.id,
          connector_1_id: match.connector_1_id,
          connector_2_id: match.connector_2_id,
        });
      }
      if (match && user) {
        const when = formatMeetingDate(scheduledAt.toISOString());
        const otherConnectorId = match.connector_1_id === user.id ? match.connector_2_id : match.connector_1_id;
        await Promise.all([
          ...[match.hopeful_1?.id, match.hopeful_2?.id].filter(Boolean).map((id: string) =>
            createNotification({
              userId: id,
              type: 'meeting_scheduled',
              title: isFirst ? `소개팅 날짜가 정해졌어요 · ${when}` : `소개팅 날짜가 바뀌었어요 · ${when}`,
              body: isFirst ? '상대 연락처를 채팅으로 보내드렸어요. 시간과 장소는 서로 연락해 정해주세요' : '바뀐 날짜에 맞춰 상대와 다시 연락해주세요',
              route: '/home',
            })
          ),
          otherConnectorId && otherConnectorId !== user.id
            ? createNotification({
                userId: otherConnectorId,
                type: 'meeting_scheduled',
                title: '동맹 매칭 날짜가 정해졌어요',
                body: `${match.hopeful_1?.name} ↔ ${match.hopeful_2?.name} · ${when}`,
                route: '/matching',
                routeParams: { segment: 'ally' },
              })
            : Promise.resolve(),
        ]);
      }

      toast.show('✓ 만남 날짜를 정했습니다', 'success');
      await fetchMatches();
    } catch (error) {
      console.error('Error:', error);
      toast.show('일정 저장 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRemindAfterCare(matchId: string, memberId: string) {
    const key = `${matchId}:${memberId}`;
    setRemindedKeys((prev) => [...prev, key]);
    try {
      await createNotification({
        userId: memberId,
        type: 'after_care_reminder',
        title: '소개팅은 어떠셨나요?',
        body: '홈 화면에서 애프터 의사를 선택해주세요',
        route: '/home',
      });
      toast.show('응답 요청을 보냈습니다', 'success');
    } catch {
      setRemindedKeys((prev) => prev.filter((k) => k !== key));
      toast.show('요청을 보내지 못했어요. 다시 시도해주세요', 'error');
    }
  }

  // 만남 완료: 두 연결자가 모두 눌러야 완료된다 (내부 매칭은 한 번에 양쪽 처리)
  async function handleMeetingDone(matchId: string) {
    if (!user) return;
    const match = matchRequests.find((m) => m.id === matchId);
    if (!match) return;

    setProcessingId(matchId);
    try {
      const mine: Record<string, boolean> = {};
      if (match.connector_1_id === user.id) mine.meeting_done_connector_1 = true;
      if (match.connector_2_id === user.id) mine.meeting_done_connector_2 = true;
      // 취소·마무리된 매칭에는 저장하지 않는다 (오래된 화면에서 누른 경우)
      const { data: marked, error } = await supabase
        .from('match_requests')
        .update(mine)
        .eq('id', matchId)
        .neq('status', 'rejected')
        .eq('settlement_completed', false)
        .select('id');
      if (error) throw error;
      if (!marked?.length) {
        toast.show('이미 취소되었거나 마무리된 매칭이에요', 'info');
        await fetchMatches();
        return;
      }

      // 저장된 최신 값으로 양쪽 확인 여부를 판단하고, 완료 처리는 한 번만 일어나게 한다
      const { data: fresh } = await supabase
        .from('match_requests')
        .select('meeting_done_connector_1, meeting_done_connector_2')
        .eq('id', matchId)
        .single();

      if (fresh?.meeting_done_connector_1 && fresh?.meeting_done_connector_2) {
        const { data: completed } = await supabase
          .from('match_requests')
          .update({ meeting_status: 'completed', meeting_completed_at: new Date().toISOString() })
          .eq('id', matchId)
          .neq('meeting_status', 'completed')
          .neq('status', 'rejected')
          .select('id');
        if (completed?.length) {
          await Promise.all(
            [match.hopeful_1?.id, match.hopeful_2?.id].filter(Boolean).map((id: string) =>
              createNotification({
                userId: id,
                type: 'after_care_requested',
                title: '소개팅은 어떠셨나요?',
                body: `${AFTER_CARE_DAYS}일 안에 홈에서 다음 만남 의사를 알려주세요`,
                route: '/home',
              })
            )
          );
        }
        toast.show('만남 완료! 회원들에게 애프터 의사를 물어볼게요', 'success');
      } else {
        const otherId = match.connector_1_id === user.id ? match.connector_2_id : match.connector_1_id;
        await createNotification({
          userId: otherId,
          type: 'meeting_done_requested',
          title: '만남 완료 확인을 기다리고 있어요',
          body: `${user.name}님이 ${match.hopeful_1?.name} ↔ ${match.hopeful_2?.name} 만남 완료를 눌렀어요`,
          route: '/matching',
          routeParams: { segment: 'ally' },
        });
        toast.show('만남 완료를 눌렀어요. 상대 파트너도 누르면 다음 단계로 넘어가요', 'success');
      }
      await fetchMatches();
    } catch (error) {
      console.error('Error:', error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  // 매칭 관리는 파트너 화면에서만 (회원 화면으로 전환한 뒤 알림으로 들어온 경우 등)
  if (user && user.role !== 'connector') {
    return <Redirect href="/home" />;
  }

  if (loading) {
    return <SkeletonScreen />;
  }

  // 내 동의가 필요한 동맹 매칭을 맨 위로, 나머지는 최신순
  const needsMyConsent = (m: any) =>
    m.connector_1_id !== m.connector_2_id &&
    ((m.connector_1_id === user?.id && !m.connector_1_consented) || (m.connector_2_id === user?.id && !m.connector_2_consented));
  const activeMatches = matchRequests.filter((m) => !m.settlement_completed);
  const historyMatches = matchRequests
    .filter((m) => m.settlement_completed)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const sortedMatches = [...activeMatches].sort((a, b) => {
    const pa = needsMyConsent(a) ? 1 : 0, pb = needsMyConsent(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // 회원 후보 목록: 줄을 누르면 선택, 사진을 누르면 프로필 크게 보기
  function renderMemberChips(allMembers: Member[], connectorId: string) {
    // 이미 고른 회원은 필터와 관계없이 계속 보인다
    const members = allMembers.filter((m) => memberFilter.passes(m, selectedForMatch.map((x) => x.id)));
    // 오래 쉰 회원 먼저 (기본): 이력 없음 → 오래전 매칭 → 최근 매칭, 진행 중인 회원은 맨 뒤
    {
      // 지금 고를 수 없는 회원(만남중·이용권 없음·같은 성별 등)은 맨 뒤로
      const key = (id: string) => { const lm = lastMatch[id]; return (blockReason(id, connectorId) ? 6e15 : 0) + (!lm ? 0 : lm.active ? 3e15 : new Date(lm.at).getTime()); };
      members.sort((x, y) => key(x.id) - key(y.id));
    }
    if (members.length === 0) return <Text style={styles.emptyCreateText}>조건에 맞는 회원이 없습니다</Text>;
    return (
      <View style={styles.memberList}>
        {members.map((m) => {
          const isSelected = selectedForMatch.some((s) => s.id === m.id);
          const block = blockReason(m.id, connectorId);
          const busy = !!block;
          const hint = busy ? null : pairHint(m.id);
          const summary = memberSummary(m);
          return (
            <View key={m.id} style={[styles.memberRow, isSelected && styles.memberRowSelected, busy && styles.memberRowBusy]}>
              <TouchableOpacity onPress={() => setPreviewMember({ member: m, connectorId })} accessibilityLabel={`${m.name} 프로필 보기`}>
                <Avatar photoUrls={m.photo_urls} size={48} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.memberRowBody} onPress={() => toggleSelectForMatch(m.id, connectorId)} accessibilityLabel={busy ? `${m.name} ${block}` : `${m.name} 선택`}>
                <View style={styles.memberRowText}>
                  <Text style={styles.memberRowName}>{m.name}</Text>
                  {!!summary && <Text style={styles.memberRowSub}>{summary}</Text>}
                  {!busy && (
                    <Text style={[styles.memberRowRest, !lastMatch[m.id] && styles.memberRowRestNew]}>
                      {hint && <Text style={styles.pairHint}>{hint} · </Text>}
                      {restLabel(m.id)}
                    </Text>
                  )}
                </View>
                {busy ? (
                  <View style={styles.busyBadge}><Text style={styles.busyBadgeText}>{block}</Text></View>
                ) : (
                  <View style={[styles.memberCheck, isSelected && styles.memberCheckOn]}>
                    {isSelected && <Text style={styles.memberCheckMark}>✓</Text>}
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  }

  const proposeBtn = selectedForMatch.length === 2 && (
    <TouchableOpacity
      style={[styles.proposeBtn, proposing && styles.buttonDisabled]}
      onPress={handleProposeMatch}
      disabled={proposing}
    >
      <Text style={styles.proposeBtnText}>{proposing ? '제안 중...' : '매칭 제안하기'}</Text>
    </TouchableOpacity>
  );

  const createSection = (
    <View style={styles.createSection}>
      {/* 제목 한 줄 + 오른쪽 '동맹 회원 포함' 칩 (동맹이 있을 때만) */}
      <View style={styles.createHeader}>
        <Text style={styles.createTitle} numberOfLines={1}>회원 2명 고르기</Text>
        <View style={styles.createTools}>
        {allyConnectors.length > 0 && (
          <TouchableOpacity
            style={[styles.allyChip, includeAllies && styles.allyChipOn]}
            onPress={() => {
              // 끄면 고르던 동맹 회원 선택도 비운다
              if (includeAllies) setSelectedForMatch((prev) => prev.filter((p) => p.connectorId === user?.id));
              setIncludeAllies(!includeAllies);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: includeAllies }}
            accessibilityLabel="동맹 회원 포함"
          >
            <Text style={[styles.allyChipText, includeAllies && styles.allyChipTextOn]}>{includeAllies ? '✓ ' : '+ '}동맹 포함</Text>
          </TouchableOpacity>
        )}
        {(ownMembers.length > 0 || includeAllies) && memberFilter.renderToggle()}
        </View>
      </View>

      {/* 회원 필터: 이름·성별·나이·지역 */}
      {/* 고를 회원이 없으면 검색·필터는 숨긴다 */}
      {(() => {
        const candidates = [...ownMembers, ...(includeAllies ? allyMembers.flatMap((g) => g.members) : [])];
        return candidates.length > 0 ? memberFilter.render(candidates, false) : null;
      })()}

      <Text style={styles.groupTitle}>내 회원</Text>
      {ownMembers.length === 0 ? (
        <Text style={styles.emptyCreateText}>승인된 회원이 없습니다</Text>
      ) : (
        renderMemberChips(ownMembers, user!.id)
      )}

      {includeAllies && allyMembers.map((g) => (
        <View key={g.connector.id}>
          <Text style={styles.groupTitle}>{g.connector.name}님 회원 (동맹)</Text>
          {g.members.length === 0 ? (
            <Text style={styles.emptyCreateText}>승인된 회원이 없습니다</Text>
          ) : (
            renderMemberChips(g.members, g.connector.id)
          )}
        </View>
      ))}
      {proposeBtn}
    </View>
  );

  // 단계로 걸러 보면 그 단계의 진행 중 매칭만 보인다
  const historyList = stageFilter ? sortedMatches.filter((m) => passesFilter(m, stageFilter, user?.id)) : [...sortedMatches, ...historyMatches];
  // 매칭내역에 보이는 순서 (아래 강조 스크롤에서 위치를 찾을 때 쓴다)
  historyOrderRef.current = historyList.map((m) => m.id);

  function renderMatchCard(item: any) {
    const crossConnector = item.connector_1_id !== item.connector_2_id;
    const consentDone = !crossConnector || (item.connector_1_consented && item.connector_2_consented);
    // 일정·진행 상태는 한 사람만 관리한다: 동맹 매칭은 제안한 연결자
    const schedulerId = crossConnector ? item.proposer_connector_id || item.connector_1_id : user?.id;
    const isScheduler = schedulerId === user?.id;
    const schedulerName = schedulerId === item.connector_1_id ? item.connector_1_name : item.connector_2_name;
    const needsMyConsent = crossConnector && (
      (item.connector_1_id === user?.id && !item.connector_1_consented) ||
      (item.connector_2_id === user?.id && !item.connector_2_consented)
    );

    return (
      <View style={[styles.matchCard, item.id === focusId && styles.matchCardFocus]}>
        <View style={styles.matchHeader}>
          <Text style={styles.matchTitle}>
            {item.hopeful_1?.name} ↔ {item.hopeful_2?.name}
          </Text>
          <Text style={styles.matchDate}>
            {new Date(item.created_at).toLocaleDateString('ko-KR')}
          </Text>
        </View>
        {/* 두 회원 프로필: 누르면 시트로 열린다 */}
        <View style={styles.pairRow}>
          {([['hopeful_1', item.connector_1_name], ['hopeful_2', item.connector_2_name]] as const).map(([k, partner]) => {
            const m = (item as any)[k];
            if (!m) return null;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.pairChip, needsMyConsent && styles.pairChipStrong]}
                onPress={() => setViewMember({ member: m, partner: crossConnector ? partner : undefined })}
                accessibilityLabel={`${m.name} 프로필 보기`}
              >
                <Avatar photoUrls={m.photo_urls} size={28} />
                <Text style={styles.pairChipText} numberOfLines={1}>
                  {[m.name, m.gender === 'M' ? '남' : m.gender === 'F' ? '여' : null, m.age && `${m.age}세`, m.location].filter(Boolean).join(' · ')}
                  {partner && crossConnector ? <Text style={styles.pairChipSub}>  {partner}</Text> : null}
                </Text>
                <Text style={styles.pairChipLink}>보기 ›</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 소개팅 상태 타임라인 */}
        <View style={styles.timeline}>
          {crossConnector && (
            <>
              <View style={styles.timelineStep}>
                <View style={styles.splitCircleContainer}>
                  <View style={[styles.halfCircle, item.connector_1_consented ? styles.timelineComplete : styles.timelinePending]}>
                    <Text style={styles.timelineIcon}>
                      {item.connector_1_consented ? '✓' : '•'}
                    </Text>
                  </View>
                  <View style={[styles.halfCircle, item.connector_2_consented ? styles.timelineComplete : styles.timelinePending]}>
                    <Text style={styles.timelineIcon}>
                      {item.connector_2_consented ? '✓' : '•'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.timelineLabel}>파트너동의</Text>
              </View>

              <View style={styles.timelineLine} />
            </>
          )}
          {/* 1단계: 매칭 (동맹 매칭은 양쪽 연결자가 모두 동의해야 회원에게 전달된다) */}
          <View style={styles.timelineStep}>
            <View style={[styles.timelineCircle, consentDone ? styles.timelineComplete : styles.timelinePending]}>
              <Text style={styles.timelineIcon}>{consentDone ? '✓' : '•'}</Text>
            </View>
            <Text style={styles.timelineLabel}>매칭</Text>
          </View>

          <View style={styles.timelineLine} />

          {/* 2단계: 승인 (반으로 쪼개기) */}
          <View style={styles.timelineStep}>
            <View style={styles.splitCircleContainer}>
              <View style={[styles.halfCircle, item.hopeful_1_approved ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.hopeful_1_approved ? '✓' : '•'}
                </Text>
              </View>
              <View style={[styles.halfCircle, item.hopeful_2_approved ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.hopeful_2_approved ? '✓' : '•'}
                </Text>
              </View>
            </View>
            <Text style={styles.timelineLabel}>승인</Text>
          </View>

          <View style={styles.timelineLine} />

          {/* 3단계: 소개팅 (반으로 쪼개기) */}
          <View style={styles.timelineStep}>
            <View style={styles.splitCircleContainer}>
              <View style={[styles.halfCircle, item.meeting_status === 'completed' || item.meeting_done_connector_1 ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.meeting_status === 'completed' || item.meeting_done_connector_1 ? '✓' : '•'}
                </Text>
              </View>
              <View style={[styles.halfCircle, item.meeting_status === 'completed' || item.meeting_done_connector_2 ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.meeting_status === 'completed' || item.meeting_done_connector_2 ? '✓' : '•'}
                </Text>
              </View>
            </View>
            <Text style={styles.timelineLabel}>소개팅</Text>
          </View>

          <View style={styles.timelineLine} />

          {/* 4단계: 정산 */}
          <View style={styles.timelineStep}>
            <View
              style={[
                styles.timelineCircle,
                item.settlement_completed ? styles.timelineComplete : styles.timelinePending,
              ]}
            >
              <Text style={styles.timelineIcon}>
                {item.settlement_completed ? '✓' : '•'}
              </Text>
            </View>
            <Text style={styles.timelineLabel}>정산</Text>
          </View>
        </View>

        {/* 소개팅 상태별 버튼 */}
        {!consentDone ? (
          needsMyConsent ? (
            <>
              <Text style={styles.consentHint}>위 두 회원 프로필을 눌러 확인한 뒤 동의해 주세요</Text>
              <TouchableOpacity
                style={[styles.actionBtn, processingId === item.id && styles.buttonDisabled]}
                onPress={() => handleConsentApprove(item.id)}
                disabled={processingId !== null}
              >
                <Text style={styles.actionBtnText}>
                  {processingId === item.id ? '처리 중...' : '✓ 이 매칭에 동의하기'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelLink}
                onPress={() => handleCancelMatch(item.id, true)}
                disabled={processingId !== null}
              >
                <Text style={styles.cancelLinkText}>이 매칭 거절하기</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.statusMessage}>
              <Text style={styles.statusMessageText}>
                {(item.connector_1_consented ? item.connector_2_name : item.connector_1_name)}님의 동의를 기다리는 중입니다
              </Text>
            </View>
          )
        ) : (
          <>
            {!(item.hopeful_1_approved && item.hopeful_2_approved) && (
              <View style={styles.statusMessage}>
                <Text style={styles.statusMessageText}>회원 참여 승인 대기 중입니다</Text>
              </View>
            )}

            {item.hopeful_1_approved && item.hopeful_2_approved && item.meeting_status !== 'completed' && (
              <View style={styles.scheduleConfirmedRow}>
                {!item.meeting_scheduled_at && item.available_dates_1?.length > 0 && item.available_dates_2?.length > 0 &&
                  !earliestCommonDate(item.available_dates_1, item.available_dates_2) && (
                  <View style={[styles.statusMessage, { marginBottom: 8 }]}>
                    <Text style={styles.statusMessageText}>두 회원의 가능한 날짜가 겹치지 않아요 · 회원이 다시 고르는 중</Text>
                  </View>
                )}
                {item.meeting_scheduled_at ? (
                  <View style={styles.scheduleLine}>
                    <Text style={styles.scheduleConfirmedText}>📅 {formatMeetingDate(item.meeting_scheduled_at)}</Text>
                    {isScheduler && !item.meeting_done_connector_1 && !item.meeting_done_connector_2 && (
                      <TouchableOpacity onPress={() => setScheduleMatchId(item.id)} disabled={processingId !== null}>
                        <Text style={styles.scheduleChangeText}>변경</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : !isScheduler ? (
                  <View style={styles.statusMessage}>
                    <Text style={styles.statusMessageText}>{schedulerName}님이 만남 날짜를 정하는 중입니다</Text>
                  </View>
                ) : null}

                {/* 날짜는 회원이 고른 가능한 날 중 겹치는 날로 자동으로 정해진다.
                    파트너가 직접 정하는 건 회원이 고른 날짜가 없는 예전 매칭뿐 (겹치지 않을 때는 작은 링크로만) */}
                {isScheduler && !item.meeting_scheduled_at && (
                  membersPickedDates(item) ? (
                    <TouchableOpacity style={styles.cancelLink} onPress={() => setScheduleMatchId(item.id)} disabled={processingId !== null}>
                      <Text style={styles.cancelLinkText}>기다리지 않고 직접 날짜 정하기</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={styles.statusMessage}>
                        <Text style={styles.statusMessageText}>회원이 고른 가능한 날짜가 없는 매칭이에요 · 두 분과 이야기해 직접 정해 주세요</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.actionBtn, processingId === item.id && styles.buttonDisabled]}
                        onPress={() => setScheduleMatchId(item.id)}
                        disabled={processingId !== null}
                      >
                        <Text style={styles.actionBtnText}>
                          {processingId === item.id ? '저장 중...' : '📅 만남 날짜 직접 정하기'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )
                )}

                {!isScheduler && item.meeting_scheduled_at && (
                  <Text style={styles.schedulerNote}>날짜 변경은 {schedulerName}님(제안 파트너)이 관리해요</Text>
                )}

                {item.meeting_scheduled_at && (() => {
                  const iAmC1 = item.connector_1_id === user?.id;
                  const myDone = iAmC1 ? item.meeting_done_connector_1 : item.meeting_done_connector_2;
                  const otherName = iAmC1 ? item.connector_2_name : item.connector_1_name;
                  const meetingDay = new Date(item.meeting_scheduled_at);
                  meetingDay.setHours(0, 0, 0, 0);
                  const beforeDay = Date.now() < meetingDay.getTime();
                  if (myDone) {
                    return (
                      <View style={styles.statusMessage}>
                        <Text style={styles.statusMessageText}>✓ 만남 완료를 눌렀어요 · {otherName}님 확인 대기</Text>
                      </View>
                    );
                  }
                  return (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.completeBtn, (processingId === item.id || beforeDay) && styles.buttonDisabled]}
                      onPress={() => handleMeetingDone(item.id)}
                      disabled={processingId !== null || beforeDay}
                    >
                      <Text style={styles.completeBtnText}>
                        {processingId === item.id
                          ? '처리 중...'
                          : beforeDay
                            ? `${formatMeetingDate(item.meeting_scheduled_at)} 당일부터 누를 수 있어요`
                            : '✓ 만남 완료'}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
            )}

            {noShowReporter(item) && (
              <View style={styles.afterCareBox}>
                <Text style={styles.afterCareTitle}>
                  {(noShowReporter(item) === 1 ? item.hopeful_1 : item.hopeful_2)?.name || '회원'}님이 '상대가 안 나왔어요'로 신고했어요
                </Text>
                <Text style={styles.afterCareHint}>상대 회원에게 확인해 보고 처리해 주세요. 노쇼가 맞으면 정산 없이 종료되고 두 회원의 이용권은 차감되지 않아요.</Text>
                <TouchableOpacity style={[styles.noShowBtn, processingId === item.id && styles.buttonDisabled]} disabled={processingId !== null} onPress={() => handleNoShowDecision(item, true)} accessibilityLabel="노쇼가 맞아요">
                  {processingId === item.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.noShowBtnText}>노쇼가 맞아요</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.noShowLink} disabled={processingId !== null} onPress={() => handleNoShowDecision(item, false)} accessibilityLabel="만났어요 신고 반려">
                  <Text style={styles.noShowLinkText}>만났어요 · 신고 반려</Text>
                </TouchableOpacity>
              </View>
            )}

            {!noShowReporter(item) && item.meeting_status === 'completed' && (item.settlement_completed || (item.after_care_hopeful_1 && item.after_care_hopeful_2)) && (
              <View style={styles.statusMessage}>
                <Text style={styles.statusMessageText}>
                  ✓ 소개팅 완료
                  {item.settlement_completed
                    ? item.closed_reason === 'no_show' ? ' - 노쇼 신고로 정산 없이 종료' : ' - 정산 완료'
                    : ' - 결과 정리 중 (자동으로 다시 시도해요)'}
                </Text>
                {item.after_care_hopeful_1 === '신청' && item.after_care_hopeful_2 === '신청' && (
                  <Text style={styles.mutualText}>💞 두 회원 모두 다시 만나고 싶어해요</Text>
                )}
              </View>
            )}

            {!noShowReporter(item) && item.meeting_status === 'completed' && !item.settlement_completed && !(item.after_care_hopeful_1 && item.after_care_hopeful_2) && (
              <View style={styles.afterCareBox}>
                <Text style={styles.afterCareTitle}>소개팅 완료 · 두 회원의 애프터 의사를 기다리는 중</Text>
                <Text style={styles.afterCareHint}>
                  두 회원이 각자 홈 화면에서 의사를 선택하면 정산이 자동으로 진행됩니다.
                  {item.meeting_completed_at ? ` ${formatDeadline(afterCareDeadline(item.meeting_completed_at))}까지 응답이 없으면 '이번이 마지막이에요'로 마무리돼요.` : ''}
                </Text>
                {[
                  { member: item.hopeful_1, answered: !!item.after_care_hopeful_1 },
                  { member: item.hopeful_2, answered: !!item.after_care_hopeful_2 },
                ].map(({ member, answered }) => {
                  if (!member) return null;
                  const key = `${item.id}:${member.id}`;
                  const reminded = remindedKeys.includes(key);
                  return (
                    <View key={member.id} style={styles.afterCareRow}>
                      <Text style={styles.afterCareName}>{member.name}</Text>
                      {answered ? (
                        <Text style={styles.afterCareDone}>응답 완료</Text>
                      ) : (
                        <TouchableOpacity
                          style={[styles.remindBtn, reminded && styles.buttonDisabled]}
                          disabled={reminded}
                          onPress={() => handleRemindAfterCare(item.id, member.id)}
                        >
                          <Text style={styles.remindBtnText}>{reminded ? '요청 보냄' : '응답 요청 보내기'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* 만남 완료 전까지는 매칭을 취소할 수 있다 (동의 요청을 받은 파트너는 위의 거절 버튼 사용) */}
        {!item.settlement_completed && item.meeting_status !== 'completed' && !needsMyConsent && (
          <TouchableOpacity
            style={styles.cancelLink}
            onPress={() => handleCancelMatch(item.id, false)}
            disabled={processingId !== null}
          >
            <Text style={styles.cancelLinkText}>매칭 취소</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>매칭</Text>
          <NotificationBell />
        </View>
      </View>

      <View style={styles.viewRow}>
        {([['active', '매칭'], ['history', `매칭내역${activeMatches.length ? ` (진행 ${activeMatches.length})` : ''}`]] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.viewBtn, view === key && styles.viewBtnActive]}
            onPress={() => { setView(key); setStageFilter(null); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === key }}
            accessibilityLabel={key === 'active' ? '매칭 제안 화면' : '매칭내역 화면'}
          >
            <Text style={[styles.viewBtnText, view === key && styles.viewBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
          ref={listRef}
          refreshControl={pullRefresh}
          // 아직 그려지지 않은 위치면 대략 그 근처로 먼저 이동한 뒤 한 번만 다시 시도한다
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
            if (scrollRetryRef.current) clearTimeout(scrollRetryRef.current);
            scrollRetryRef.current = setTimeout(() => {
              const len = historyOrderRef.current.length;
              if (view === 'history' && index < len) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
            }, 300);
          }}
          // 매칭: 제안만 / 매칭내역: 진행 중(동의 필요 먼저) → 마무리된 매칭
          data={view === 'active' ? [] : historyList}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={view === 'active' ? createSection : stageFilter ? (
            <View style={styles.stageBar}>
              <Text style={styles.stageBarText}>{FILTER_LABEL[stageFilter]} {historyList.length}건만 보는 중</Text>
              <TouchableOpacity onPress={() => setStageFilter(null)} accessibilityLabel="전체 매칭 보기">
                <Text style={styles.stageBarAll}>전체 보기</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          ListEmptyComponent={
            view === 'history' ? (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>{stageFilter ? `${FILTER_LABEL[stageFilter]} 매칭이 없어요` : '매칭 내역이 없습니다'}</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => renderMatchCard(item)}
          contentContainerStyle={styles.list}
        />

      <DatePickerSheet
        visible={scheduleMatchId !== null}
        initialDate={(() => {
          const at = matchRequests.find((m) => m.id === scheduleMatchId)?.meeting_scheduled_at;
          return at ? new Date(at) : undefined;
        })()}
        onClose={() => setScheduleMatchId(null)}
        onConfirm={(date) => scheduleMatchId && handleSetSchedule(scheduleMatchId, date)}
      />

      <BottomSheet visible={viewMember !== null} onClose={() => setViewMember(null)} title={viewMember?.partner ? `${viewMember.partner} 파트너의 회원` : '회원 프로필'}>
        {viewMember && <MemberProfileView member={viewMember.member} showBirthDate />}
      </BottomSheet>

      <BottomSheet visible={previewMember !== null} onClose={() => setPreviewMember(null)} title="회원 프로필">
        {previewMember && (() => {
          const { member, connectorId } = previewMember;
          const isSelected = selectedForMatch.some((s) => s.id === member.id);
          const block = blockReason(member.id, connectorId);
          const busy = !!block;
          return (
            <>
              <MemberProfileView member={member} showBirthDate />
              <TouchableOpacity
                style={[styles.proposeBtn, busy && styles.buttonDisabled]}
                disabled={busy && block !== '이용권 없음'}
                onPress={() => {
                  toggleSelectForMatch(member.id, connectorId);
                  setPreviewMember(null);
                }}
              >
                <Text style={styles.proposeBtnText}>{busy ? `고를 수 없어요 · ${block}` : isSelected ? '선택 해제' : '이 회원 선택'}</Text>
              </TouchableOpacity>
            </>
          );
        })()}
      </BottomSheet>
    </View>
  );
}

type BlockLabel = '만남중' | '이용권 없음' | '같은 성별' | '내 회원과만 가능';
const BLOCK_MESSAGE: Record<BlockLabel, string> = {
  만남중: '만남이 진행 중인 회원이에요. 만남이 끝나면 고를 수 있어요',
  '이용권 없음': '남은 이용권이 없는 회원이에요. 이용권을 산 뒤에 고를 수 있어요',
  '같은 성별': '먼저 고른 회원과 같은 성별이에요',
  '내 회원과만 가능': '동맹 회원끼리는 매칭할 수 없어요. 내 회원을 한 명 포함해주세요',
};

const styles = StyleSheet.create({
  pairHint: { color: '#322F38', fontWeight: '700' },
  memberRowBusy: { opacity: 0.5 },
  noShowBtn: { marginTop: 12, backgroundColor: '#5B21FF', borderRadius: 10, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  noShowBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  noShowLink: { alignItems: 'center', paddingVertical: 12 },
  noShowLinkText: { fontSize: 13, color: '#65626B', textDecorationLine: 'underline' },
  busyBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#EFEDF2' },
  busyBadgeText: { fontSize: 12, fontWeight: '700', color: '#65626B' },
  stageBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F7F4FF', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12 },
  stageBarText: { fontSize: 13, color: '#322F38', fontWeight: '600' },
  stageBarAll: { fontSize: 13, color: '#5B21FF', fontWeight: '600', paddingVertical: 4 },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#322F38',
  },
  createSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEDF2',
  },
  createTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#322F38',
  },
  emptyCreateText: {
    fontSize: 13,
    color: '#98959E',
  },
  backLink: {
    fontSize: 13,
    color: '#5B21FF',
    fontWeight: '600',
    marginTop: 4,
  },
  matchCardFocus: {
    borderWidth: 2,
    borderColor: '#5B21FF',
    backgroundColor: '#F7F4FF',
  },
  viewRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#F3F1F6',
    borderRadius: 10,
    padding: 4,
  },
  viewBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  viewBtnActive: {
    backgroundColor: '#fff',
  },
  viewBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#98959E',
  },
  viewBtnTextActive: {
    color: '#5B21FF',
  },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  createTools: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  allyChip: { borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, paddingHorizontal: 12, minHeight: 38, justifyContent: 'center' },
  allyChipOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  allyChipText: { fontSize: 14, color: '#65626B' },
  allyChipTextOn: { color: '#5B21FF', fontWeight: '600' },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#65626B',
    marginTop: 12,
    marginBottom: 8,
  },
  memberList: {
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#EDEBF0',
    borderRadius: 12,
    padding: 10,
  },
  memberRowSelected: {
    borderColor: '#5B21FF',
    backgroundColor: '#F7F4FF',
  },
  memberRowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  memberRowText: {
    flex: 1,
  },
  memberRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#211E27',
  },
  memberRowSub: {
    fontSize: 13,
    color: '#87848D',
    marginTop: 2,
  },
  memberCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBC8D1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCheckOn: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  memberCheckMark: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  cancelLink: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelLinkText: {
    fontSize: 13,
    color: '#98959E',
    textDecorationLine: 'underline',
  },
  mutualText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B21FF',
    marginTop: 6,
  },
  memberChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  memberChip: {
    borderWidth: 1,
    borderColor: '#DCD9E2',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  memberChipSelected: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  memberChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#322F38',
  },
  memberChipTextSelected: {
    color: '#fff',
  },
  proposeBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  proposeBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  placeholder: {
    paddingVertical: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: '#98959E',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  matchCard: {
    backgroundColor: '#F8F6FB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  matchHeader: {
    marginBottom: 12,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#322F38',
    marginBottom: 4,
  },
  memberRowRest: { fontSize: 12, color: '#8F8C95', marginTop: 2 },
  memberRowRestNew: { color: '#5B21FF' },
  pairRow: { gap: 6, marginTop: 10, marginBottom: 12 },
  pairChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: '#E6E3EC', backgroundColor: '#fff' },
  pairChipStrong: { borderColor: '#5B21FF' },
  pairChipText: { flex: 1, fontSize: 13, color: '#322F38', fontWeight: '600' },
  pairChipLink: { fontSize: 12, color: '#5B21FF' },
  pairChipSub: { fontSize: 12, color: '#8F8C95', fontWeight: '400' },
  consentHint: { fontSize: 12, color: '#8F8C95', textAlign: 'center', marginBottom: 8 },
  matchDate: {
    fontSize: 12,
    color: '#98959E',
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  splitCircleContainer: {
    flexDirection: 'row',
    width: 32,
    height: 32,
    marginBottom: 8,
    gap: 2,
  },
  halfCircle: {
    flex: 1,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  timelineCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 2,
  },
  timelineComplete: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  timelinePending: {
    backgroundColor: '#fff',
    borderColor: '#DCD9E2',
  },
  timelineIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  timelineLabel: {
    fontSize: 10,
    color: '#65626B',
    textAlign: 'center',
  },
  timelineLine: {
    height: 2,
    flex: 1,
    backgroundColor: '#DCD9E2',
    marginBottom: 20,
  },
  scheduleConfirmedRow: {
    marginTop: 8,
  },
  scheduleLine: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  scheduleConfirmedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B21FF',
    textAlign: 'center',
  },
  schedulerNote: {
    fontSize: 12,
    color: '#87848D',
    textAlign: 'center',
  },
  scheduleChangeText: {
    fontSize: 12,
    color: '#87848D',
    textDecorationLine: 'underline',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  actionBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  completeBtn: {
    backgroundColor: '#5B21FF',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  completeBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusMessage: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  afterCareBox: {
    backgroundColor: '#F8F6FB',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    gap: 8,
  },
  afterCareTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#322F38',
  },
  afterCareHint: {
    fontSize: 12,
    color: '#87848D',
    lineHeight: 17,
  },
  afterCareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  afterCareName: {
    fontSize: 14,
    color: '#322F38',
  },
  afterCareDone: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B21FF',
  },
  remindBtn: {
    borderWidth: 1,
    borderColor: '#5B21FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  remindBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5B21FF',
  },
  statusMessageText: {
    color: '#5B21FF',
    fontWeight: '500',
    fontSize: 12,
  },
});
