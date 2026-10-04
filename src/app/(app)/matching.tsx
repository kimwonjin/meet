import React, { useState, useEffect } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getCredit } from '@/lib/payments';
import AlliancesScreen from './alliances';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';
import DatePickerSheet from '@/components/DatePickerSheet';
import { formatMeetingDate } from '@/lib/format';
import { earliestCommonDate, sendContactsViaChat } from '@/lib/schedule';
import BottomSheet from '@/components/BottomSheet';
import { Avatar, PhotoList } from '@/components/ProfilePhoto';
import { AFTER_CARE_DAYS, afterCareDeadline, expireAfterCareIfDue, formatDeadline } from '@/lib/afterCare';

type Segment = 'internal' | 'ally' | 'alliance';

// 매칭 후보로 고를 회원 (사진·나이·지역을 보고 고른다)
type Member = { id: string; name: string; gender?: string; age?: number; location?: string; photo_urls?: string[] };
const MEMBER_FIELDS = 'id, name, gender, age, location, photo_urls, height, job';

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
  const [segment, setSegment] = useState<Segment>('internal');
  const router = useRouter();
  // 알림에서 들어오면 해당 칸(예: 동맹매칭)을 바로 연다
  const params = useLocalSearchParams<{ segment?: Segment }>();
  useEffect(() => {
    if (params.segment) {
      setSegment(params.segment);
      router.setParams({ segment: undefined });
    }
  }, [params.segment]);

  const [ownMembers, setOwnMembers] = useState<Member[]>([]);
  const [allyConnectors, setAllyConnectors] = useState<{ id: string; name: string }[]>([]);
  const [selectedAllyConnector, setSelectedAllyConnector] = useState<{ id: string; name: string } | null>(null);
  const [allyConnectorMembers, setAllyConnectorMembers] = useState<Member[]>([]);
  // 프로필을 크게 보고 있는 후보 회원
  const [previewMember, setPreviewMember] = useState<{ member: Member; connectorId: string } | null>(null);
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
    setOwnMembers((users || []) as Member[]);
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
      return;
    }
    const { data: users } = await supabase.from('users').select('id, name').in('id', allyIds);
    setAllyConnectors((users || []).map((u: any) => ({ id: u.id, name: u.name })));
  }

  async function selectAllyConnector(conn: { id: string; name: string }) {
    setSelectedAllyConnector(conn);
    setSelectedForMatch([]);
    const { data } = await supabase
      .from('hopeful_requests')
      .select('hopeful_id')
      .eq('connector_id', conn.id)
      .eq('status', 'approved');
    const ids = (data || []).map((r: any) => r.hopeful_id);
    if (ids.length === 0) {
      setAllyConnectorMembers([]);
      return;
    }
    const { data: users } = await supabase.from('users').select(MEMBER_FIELDS).in('id', ids);
    setAllyConnectorMembers((users || []) as Member[]);
  }

  function toggleSelectForMatch(memberId: string, connectorId: string) {
    setSelectedForMatch((prev) => {
      const exists = prev.find((s) => s.id === memberId);
      if (exists) return prev.filter((s) => s.id !== memberId);
      if (prev.length >= 2) {
        toast.show('최대 2명까지 선택할 수 있습니다', 'error');
        return prev;
      }
      return [...prev, { id: memberId, connectorId }];
    });
  }

  function memberName(id: string) {
    return [...ownMembers, ...allyConnectorMembers].find((m) => m.id === id)?.name ?? '회원';
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
          body: `${user.name}님이 회원 매칭을 제안했습니다. 매칭 › 동맹매칭에서 확인해주세요`,
          route: '/matching',
          routeParams: { segment: 'ally' },
        });
      } else {
        await Promise.all([
          createNotification({ userId: a.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
          createNotification({ userId: b.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
        ]);
      }

      toast.show('✓ 매칭을 제안했습니다', 'success');
      setSelectedForMatch([]);
      setSelectedAllyConnector(null);
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
      if (error || !result) throw error;
      if (!result.ok) {
        toast.show(result.reason === 'meeting_done' ? '만남이 끝난 매칭은 취소할 수 없어요' : '이미 종료된 매칭이에요', 'error');
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
      const { error } = await supabase.from('match_requests').update(mine).eq('id', matchId);
      if (error) throw error;

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
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  const internalMatches = [...matchRequests]
    .filter((m) => m.connector_1_id === m.connector_2_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const pendingConsentCount = matchRequests.filter(
    (m) =>
      m.connector_1_id !== m.connector_2_id &&
      ((m.connector_1_id === user?.id && !m.connector_1_consented) || (m.connector_2_id === user?.id && !m.connector_2_consented))
  ).length;
  const allyMatches = [...matchRequests]
    .filter((m) => m.connector_1_id !== m.connector_2_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // 회원 후보 목록: 줄을 누르면 선택, 사진을 누르면 프로필 크게 보기
  function renderMemberChips(members: Member[], connectorId: string) {
    return (
      <View style={styles.memberList}>
        {members.map((m) => {
          const isSelected = selectedForMatch.some((s) => s.id === m.id);
          const summary = memberSummary(m);
          return (
            <View key={m.id} style={[styles.memberRow, isSelected && styles.memberRowSelected]}>
              <TouchableOpacity onPress={() => setPreviewMember({ member: m, connectorId })} accessibilityLabel={`${m.name} 프로필 보기`}>
                <Avatar photoUrls={m.photo_urls} size={48} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.memberRowBody} onPress={() => toggleSelectForMatch(m.id, connectorId)}>
                <View style={styles.memberRowText}>
                  <Text style={styles.memberRowName}>{m.name}</Text>
                  {!!summary && <Text style={styles.memberRowSub}>{summary}</Text>}
                </View>
                <View style={[styles.memberCheck, isSelected && styles.memberCheckOn]}>
                  {isSelected && <Text style={styles.memberCheckMark}>✓</Text>}
                </View>
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

  const internalCreateSection = (
    <View style={styles.createSection}>
      <Text style={styles.createTitle}>회원 2명을 선택해 매칭을 제안하세요</Text>
      {ownMembers.length === 0 ? (
        <Text style={styles.emptyCreateText}>승인된 회원이 없습니다</Text>
      ) : (
        renderMemberChips(ownMembers, user!.id)
      )}
      {proposeBtn}
    </View>
  );

  const allyCreateSection = (
    <View style={styles.createSection}>
      {!selectedAllyConnector ? (
        <>
          <Text style={styles.createTitle}>동맹 파트너를 선택하세요</Text>
          {allyConnectors.length === 0 ? (
            <Text style={styles.emptyCreateText}>활성화된 동맹이 없습니다</Text>
          ) : (
            <View style={styles.memberChipWrap}>
              {allyConnectors.map((c) => (
                <TouchableOpacity key={c.id} style={styles.memberChip} onPress={() => selectAllyConnector(c)}>
                  <Text style={styles.memberChipText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <TouchableOpacity onPress={() => { setSelectedAllyConnector(null); setSelectedForMatch([]); }}>
            <Text style={styles.backLink}>‹ 동맹 파트너 다시 선택</Text>
          </TouchableOpacity>
          <Text style={styles.createTitle}>내 회원 선택</Text>
          {ownMembers.length === 0 ? (
            <Text style={styles.emptyCreateText}>승인된 회원이 없습니다</Text>
          ) : (
            renderMemberChips(ownMembers, user!.id)
          )}
          <Text style={styles.createTitle}>{selectedAllyConnector.name}의 회원 선택</Text>
          {allyConnectorMembers.length === 0 ? (
            <Text style={styles.emptyCreateText}>승인된 회원이 없습니다</Text>
          ) : (
            renderMemberChips(allyConnectorMembers, selectedAllyConnector.id)
          )}
          {proposeBtn}
        </>
      )}
    </View>
  );

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
      <View style={styles.matchCard}>
        <View style={styles.matchHeader}>
          <Text style={styles.matchTitle}>
            {item.hopeful_1?.name} ↔ {item.hopeful_2?.name}
          </Text>
          <Text style={styles.matchDate}>
            {new Date(item.created_at).toLocaleDateString('ko-KR')}
          </Text>
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

                {isScheduler && !item.meeting_scheduled_at && (
                  <TouchableOpacity
                    style={[styles.actionBtn, processingId === item.id && styles.buttonDisabled]}
                    onPress={() => setScheduleMatchId(item.id)}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.actionBtnText}>
                      {processingId === item.id ? '저장 중...' : '📅 만남 날짜 정하기'}
                    </Text>
                  </TouchableOpacity>
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

            {item.meeting_status === 'completed' && (item.settlement_completed || (item.after_care_hopeful_1 && item.after_care_hopeful_2)) && (
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

            {item.meeting_status === 'completed' && !item.settlement_completed && !(item.after_care_hopeful_1 && item.after_care_hopeful_2) && (
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

      <View style={styles.segmentRow}>
        {([
          { key: 'internal', label: '내부매칭' },
          { key: 'ally', label: '동맹매칭' },
          { key: 'alliance', label: '동맹관리' },
        ] as { key: Segment; label: string }[]).map((s) => {
          const badge = s.key === 'ally' ? pendingConsentCount : 0;
          return (
          <TouchableOpacity
            key={s.key}
            style={[styles.segmentBtn, segment === s.key && styles.segmentBtnActive]}
            onPress={() => {
              // 칸을 바꾸면 고르던 회원 선택을 비운다 (다른 칸의 선택으로 제안되지 않도록)
              setSegment(s.key);
              setSelectedForMatch([]);
              setSelectedAllyConnector(null);
            }}
          >
            <Text style={[styles.segmentBtnText, segment === s.key && styles.segmentBtnTextActive]}>
              {s.label}
            </Text>
            {badge > 0 && (
              <View style={styles.segmentBadge}>
                <Text style={styles.segmentBadgeText}>{badge}</Text>
              </View>
            )}
          </TouchableOpacity>
          );
        })}
      </View>

      {segment === 'alliance' ? (
        <AlliancesScreen />
      ) : (
        <FlatList
          data={segment === 'internal' ? internalMatches : allyMatches}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={segment === 'internal' ? internalCreateSection : allyCreateSection}
          ListEmptyComponent={
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>진행 중인 매칭이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => renderMatchCard(item)}
          contentContainerStyle={styles.list}
        />
      )}

      <DatePickerSheet
        visible={scheduleMatchId !== null}
        initialDate={(() => {
          const at = matchRequests.find((m) => m.id === scheduleMatchId)?.meeting_scheduled_at;
          return at ? new Date(at) : undefined;
        })()}
        onClose={() => setScheduleMatchId(null)}
        onConfirm={(date) => scheduleMatchId && handleSetSchedule(scheduleMatchId, date)}
      />

      <BottomSheet visible={previewMember !== null} onClose={() => setPreviewMember(null)} title={previewMember?.member.name ?? ''}>
        {previewMember && (() => {
          const { member, connectorId } = previewMember;
          const isSelected = selectedForMatch.some((s) => s.id === member.id);
          return (
            <>
              <PhotoList photoUrls={member.photo_urls} />
              <Text style={styles.previewInfo}>{memberSummary(member) || '등록된 정보가 없습니다'}</Text>
              <TouchableOpacity
                style={styles.proposeBtn}
                onPress={() => {
                  toggleSelectForMatch(member.id, connectorId);
                  setPreviewMember(null);
                }}
              >
                <Text style={styles.proposeBtnText}>{isSelected ? '선택 해제' : '이 회원 선택'}</Text>
              </TouchableOpacity>
            </>
          );
        })()}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: '#333',
  },
  segmentRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#F5F5F7',
    borderRadius: 10,
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginLeft: 4,
  },
  segmentBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
  },
  segmentBtnTextActive: {
    color: '#5B21FF',
  },
  createSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  createTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginTop: 12,
    marginBottom: 10,
  },
  emptyCreateText: {
    fontSize: 13,
    color: '#999',
  },
  backLink: {
    fontSize: 13,
    color: '#5B21FF',
    fontWeight: '600',
    marginTop: 4,
  },
  memberList: {
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#eee',
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
    color: '#222',
  },
  memberRowSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  memberCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ccc',
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
    color: '#999',
    textDecorationLine: 'underline',
  },
  mutualText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B21FF',
    marginTop: 6,
  },
  previewInfo: {
    fontSize: 14,
    color: '#555',
    marginTop: 12,
    marginBottom: 16,
  },
  memberChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  memberChip: {
    borderWidth: 1,
    borderColor: '#ddd',
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
    color: '#333',
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
    color: '#999',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  matchCard: {
    backgroundColor: '#f9f9f9',
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
    color: '#333',
    marginBottom: 4,
  },
  matchDate: {
    fontSize: 12,
    color: '#999',
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
    borderColor: '#ddd',
  },
  timelineIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  timelineLabel: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
  },
  timelineLine: {
    height: 2,
    flex: 1,
    backgroundColor: '#ddd',
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
    color: '#888',
    textAlign: 'center',
  },
  scheduleChangeText: {
    fontSize: 12,
    color: '#888',
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
    backgroundColor: '#F9F9F9',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    gap: 8,
  },
  afterCareTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  afterCareHint: {
    fontSize: 12,
    color: '#888',
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
    color: '#333',
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
