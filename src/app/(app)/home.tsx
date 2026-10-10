import React, { useState, useEffect } from 'react';
import SkeletonScreen from '@/components/Skeleton';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useFocusPolling } from '@/hooks/use-focus-polling';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';
import { getMyConnectorCredits } from '@/lib/payments';
import BottomSheet from '@/components/BottomSheet';
import { formatMeetingDate } from '@/lib/format';
import AvailableDatesSheet from '@/components/AvailableDatesSheet';
import { toDateKey } from '@/components/CalendarGrid';
import { autoScheduleMatch, earliestCommonDate } from '@/lib/schedule';
import { afterCareDeadline, expireAfterCareIfDue, formatDeadline, notifyAfterCareResult } from '@/lib/afterCare';
import { Avatar } from '@/components/ProfilePhoto';
import MemberProfileView from '@/components/MemberProfileView';
import SafetyActions from '@/components/SafetyActions';
import InviteSheet from '@/components/InviteSheet';
import { isOverdueForMe, isWaitingOnOthers, matchStage, MatchStage, needsMyConsent, needsMyDate, schedulerOf } from '@/lib/matchStage';
import ReviewSheet from '@/components/ReviewSheet';
import { fetchMyReviewedMatchIds, submitReview } from '@/lib/reviews';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const meetTime = (iso: string) => {
  const d = new Date(iso);
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ''}`;
};

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Connector states
  const [matchingRequests, setMatchingRequests] = useState<any[]>([]);
  const [pendingSignupCount, setPendingSignupCount] = useState(0);

  // Hopeful states
  const [receivedMatches, setReceivedMatches] = useState<any[]>([]);
  const [remainingSessions, setRemainingSessions] = useState<number | null>(null);
  // 회원 홈 시트: 소개 카드 목록(ids), profileOf가 있으면 그 소개의 상대 프로필
  const [matchSheet, setMatchSheet] = useState<{ title: string; ids: string[]; profileOf?: string } | null>(null);
  const [freeSessions, setFreeSessions] = useState(0);
  const [partnerNames, setPartnerNames] = useState<Record<string, string>>({});
  // 내 파트너 가입 상태: 승인된 파트너 수 · 신청(대기 포함) 수
  const [myPartners, setMyPartners] = useState({ approved: 0, requested: 0 });
  const [approvedMemberCount, setApprovedMemberCount] = useState(0);
  const [profileGaps, setProfileGaps] = useState<string[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  // 파트너 홈 '내 현황': 이번 달 성사 · 출금 가능 금액 · 최근 7일 초대 링크 열람 (null = 아직 모름/준비 전)
  const [settledThisMonth, setSettledThisMonth] = useState(0);
  const [payoutAvailable, setPayoutAvailable] = useState<number | null>(null);
  // 가입 신청한 사람 (최근 3명) · 최근 소식 (알림 3개) · 알림 센터 열기 신호
  const [pendingMembers, setPendingMembers] = useState<{ id: string; name: string }[]>([]);
  // 새 파트너 시작 가이드: 매칭을 제안해 본 적 · 만남이 성사된 적이 있는지 (null = 아직 모름)
  const [startState, setStartState] = useState<{ proposed: boolean; settled: boolean } | null>(null);

  // 후기를 남긴 매칭 / 후기 작성 중인 매칭
  const [reviewedMatchIds, setReviewedMatchIds] = useState<string[]>([]);
  const [reviewTarget, setReviewTarget] = useState<{ matchId: string; connectorId: string } | null>(null);
  const [reviewPartnerName, setReviewPartnerName] = useState<string | undefined>(undefined);
  useEffect(() => {
    setReviewPartnerName(undefined);
    if (!reviewTarget) return;
    supabase.from('connectors').select('business_name').eq('id', reviewTarget.connectorId).maybeSingle()
      .then(({ data }) => setReviewPartnerName(data?.business_name || undefined));
  }, [reviewTarget]);
  // 날짜 선택 시트: 승인할 때(approve) 또는 날짜가 겹치지 않아 다시 고를 때(reselect)
  const [datesTarget, setDatesTarget] = useState<{ matchId: string; mode: 'approve' | 'reselect' } | null>(null);

  useEffect(() => {
    if (user) {
      fetchDashboard();
    }
  }, [user]);

  // 열어 둔 소개가 사라지면 (거절·취소) 시트를 닫는다
  useEffect(() => {
    if (matchSheet && !receivedMatches.some((m) => matchSheet.ids.includes(m.id))) setMatchSheet(null);
  }, [receivedMatches]);

  useFocusPolling(() => fetchDashboard(), 15000, !!user);
  const pullRefresh = usePullRefresh(() => fetchDashboard());

  async function fetchDashboard(retried = false) {
    try {
      if (user?.role === 'connector') {
        // 처리 대기 요약: 가입 대기 건수
        const { count: pendingCount } = await supabase
          .from('hopeful_requests')
          .select('*', { count: 'exact', head: true })
          .eq('connector_id', user!.id)
          .eq('status', 'pending');
        setPendingSignupCount(pendingCount || 0);
        const { data: pendRows } = await supabase
          .from('hopeful_requests')
          .select('hopeful_id, created_at')
          .eq('connector_id', user!.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(3);
        const pendIds = (pendRows || []).map((r: any) => r.hopeful_id);
        const { data: pendUsers } = pendIds.length ? await supabase.from('users').select('id, name').in('id', pendIds) : { data: [] as any[] };
        setPendingMembers(pendIds.map((id: string) => ({ id, name: (pendUsers || []).find((u: any) => u.id === id)?.name || '회원' })));
        const { count: memberCount } = await supabase
          .from('hopeful_requests')
          .select('*', { count: 'exact', head: true })
          .eq('connector_id', user!.id)
          .eq('status', 'approved');
        setApprovedMemberCount(memberCount || 0);

        // 연결자: 내가 제안한 매칭들 조회
        const { data: matchData } = await supabase
          .from('match_requests')
          .select('*')
          .or(`connector_1_id.eq.${user!.id},connector_2_id.eq.${user!.id}`);

        // 애프터 응답 기한이 지났거나 마무리가 밀린 매칭은 정리하고 다시 불러온다
        const expiredConn = await Promise.all((matchData || []).map((m: any) => expireAfterCareIfDue(m)));
        if (expiredConn.some(Boolean) && !retried) return fetchDashboard(true);

        // 매칭 데이터와 희망자 정보 결합
        const hopefulUserIds = (matchData || []).flatMap((m: any) => [
          m.hopeful_1_id,
          m.hopeful_2_id,
        ]);
        const { data: matchHopefuls } = await supabase
          .from('users')
          .select('*')
          .in('id', hopefulUserIds);

        const matches = (matchData || []).map((m: any) => {
          const hopeful1 = (matchHopefuls || []).find((h: any) => h.id === m.hopeful_1_id);
          const hopeful2 = (matchHopefuls || []).find((h: any) => h.id === m.hopeful_2_id);
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
            created_at: m.created_at,
            meeting_scheduled_at: m.meeting_scheduled_at,
            status: m.status,
            connector_1_id: m.connector_1_id,
            connector_2_id: m.connector_2_id,
            connector_1_consented: m.connector_1_consented,
            connector_2_consented: m.connector_2_consented,
            proposer_connector_id: m.proposer_connector_id,
            meeting_done_connector_1: m.meeting_done_connector_1,
            meeting_done_connector_2: m.meeting_done_connector_2,
            available_dates_1: m.available_dates_1,
            available_dates_2: m.available_dates_2,
          };
        });

        setStartState({
          proposed: (matchData || []).length > 0,
          settled: (matchData || []).some((m: any) => m.settlement_completed && !m.closed_reason),
        });

        // 이번 달 성사된 만남 (노쇼 등으로 정산 없이 끝난 건 제외)
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        setSettledThisMonth((matchData || []).filter((m: any) =>
          m.settlement_completed && !m.closed_reason && m.settlement_completed_at && new Date(m.settlement_completed_at) >= monthStart
        ).length);
        supabase.rpc('fn_connector_available_payout', { p_connector_id: user!.id }).then(({ data, error }) => setPayoutAvailable(error ? null : Number(data) || 0));

        // 홈에는 진행 중인 매칭만 (완료·거절된 매칭 제외), 최신순
        setMatchingRequests(
          matches
            .filter((m: any) => !m.settlement_completed && m.status !== 'rejected')
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        );
      } else {
        // 프로필이 비어 있으면 파트너가 소개하기 어렵다 → 채울 항목을 알려준다
        const { data: me } = await supabase.from('users').select('photo_urls, bio, job, height').eq('id', user!.id).maybeSingle();
        setProfileGaps([
          !(me?.photo_urls ?? []).some(Boolean) && '사진',
          !me?.bio && '자기소개',
          !me?.job && '직업',
          !me?.height && '키',
        ].filter(Boolean) as string[]);

        // 회원: 받은 매칭 제안 조회
        const { data: reqData } = await supabase
          .from('match_requests')
          .select('*')
          .or(`hopeful_1_id.eq.${user!.id},hopeful_2_id.eq.${user!.id}`)
          .in('status', ['pending', 'approved', 'completed'])
          .order('created_at', { ascending: false });

        const hopefulUserIds = (reqData || []).flatMap((r: any) => [
          r.hopeful_1_id,
          r.hopeful_2_id,
        ]);
        const { data: hopefulUsers } = await supabase
          .from('users')
          .select('*')
          .in('id', hopefulUserIds);

        // 동맹 연결자 회원과의 교차매칭은 상대 연결자가 동의하기 전까지 회원에게 보이지 않는다
        const consentedReqData = (reqData || []).filter(
          (r: any) => r.connector_1_id === r.connector_2_id || (r.connector_1_consented && r.connector_2_consented)
        );

        const matches = consentedReqData.map((r: any) => {
          const isHopeful1 = user!.id === r.hopeful_1_id;
          const partnerId = isHopeful1 ? r.hopeful_2_id : r.hopeful_1_id;
          const partner = (hopefulUsers || []).find((u: any) => u.id === partnerId);

          return {
            id: r.id,
            partner,
            hopeful_1_approved: r.hopeful_1_approved,
            hopeful_2_approved: r.hopeful_2_approved,
            after_care_hopeful_1: r.after_care_hopeful_1,
            after_care_hopeful_2: r.after_care_hopeful_2,
            meeting_status: r.meeting_status,
            meeting_scheduled_at: r.meeting_scheduled_at,
            meeting_completed_at: r.meeting_completed_at,
            closed_reason: r.closed_reason,
            available_dates_1: r.available_dates_1,
            available_dates_2: r.available_dates_2,
            settlement_completed: r.settlement_completed,
            isHopeful1,
            created_at: r.created_at,
            connector_1_id: r.connector_1_id,
            connector_2_id: r.connector_2_id,
          };
        });

        setReceivedMatches(matches);
        setReviewedMatchIds(await fetchMyReviewedMatchIds(user!.id));

        // 두 회원이 모두 승인했고 겹치는 날이 있는데 일정이 비어 있으면 (이전 시도가 실패한 경우) 다시 맞춘다
        const unscheduled = consentedReqData.filter((r: any) =>
          r.status !== 'rejected' && r.hopeful_1_approved && r.hopeful_2_approved && !r.meeting_scheduled_at &&
          earliestCommonDate(r.available_dates_1, r.available_dates_2)
        );
        if (unscheduled.length && !retried) {
          await Promise.all(unscheduled.map((r: any) => autoScheduleMatch(r.id).catch((e) => console.error('autoSchedule retry error:', e))));
          return fetchDashboard(true);
        }

        // 애프터 응답 기한이 지난 매칭은 자동으로 마무리하고 다시 불러온다
        const expired = await Promise.all(consentedReqData.map((r: any) => expireAfterCareIfDue(r)));
        if (expired.some(Boolean) && !retried) return fetchDashboard(true);

        const { data: credits } = await getMyConnectorCredits(user!.id);
        setRemainingSessions((credits || []).reduce((sum: number, c: any) => sum + c.available, 0));
        setFreeSessions((credits || []).reduce((sum: number, c: any) => sum + Math.min(c.freeAvailable || 0, c.available), 0));

        // 소개해 준 파트너 이름 (카드에 '○○ 추천')
        const connIds = [...new Set(matches.map((m: any) => (m.isHopeful1 ? m.connector_1_id : m.connector_2_id)).filter(Boolean))];
        if (connIds.length) {
          const { data: conns } = await supabase.from('connectors').select('id, business_name').in('id', connIds);
          setPartnerNames(Object.fromEntries((conns || []).map((c: any) => [c.id, c.business_name || '파트너'])));
        }
        const { data: reqs } = await supabase.from('hopeful_requests').select('status').eq('hopeful_id', user!.id);
        setMyPartners({
          approved: (reqs || []).filter((r: any) => r.status === 'approved').length,
          requested: (reqs || []).filter((r: any) => r.status === 'approved' || r.status === 'pending').length,
        });
      }
    } catch (error) {
      console.error('fetchDashboard error:', error);
    } finally {
      setLoading(false);
    }
  }

  function showScheduleResult(result: Awaited<ReturnType<typeof autoScheduleMatch>>) {
    if (result.status === 'scheduled') toast.show(`📅 소개팅 날짜가 정해졌어요 · ${formatMeetingDate(result.at)}`, 'success');
    if (result.status === 'no_overlap') toast.show('상대와 겹치는 날짜가 없어요. 날짜를 다시 골라주세요', 'info');
  }

  async function handleApproveMatch(matchId: string, dates: string[]) {
    if (!user) return;
    setDatesTarget(null);

    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);
      const isHopeful1 = match?.isHopeful1;

      const updateData = isHopeful1
        ? { hopeful_1_approved: true, available_dates_1: dates }
        : { hopeful_2_approved: true, available_dates_2: dates };

      // 오래된 화면에서 누른 경우: 이미 거절·취소된 매칭에는 저장하지 않는다
      const { data: saved, error } = await supabase
        .from('match_requests')
        .update(updateData)
        .eq('id', matchId)
        .neq('status', 'rejected')
        .select('id');

      if (error) throw error;
      if (!saved?.length) {
        toast.show('이미 종료된 매칭이에요', 'info');
        setProcessingId(null);
        await fetchDashboard();
        return;
      }

      if (match?.connector_1_id) {
        await createNotification({
          userId: match.connector_1_id,
          type: 'match_approved',
          title: '회원이 매칭에 참여를 승인했습니다',
          body: `${user.name}님이 매칭 참여를 승인했습니다`,
          route: '/matching',
        });
      }
      if (match?.connector_2_id && match.connector_2_id !== match.connector_1_id) {
        await createNotification({
          userId: match.connector_2_id,
          type: 'match_approved',
          title: '회원이 매칭에 참여를 승인했습니다',
          body: `${user.name}님이 매칭 참여를 승인했습니다`,
          route: '/matching',
        });
      }

      toast.show('✓ 매칭을 승인했습니다', 'success');
      // 승인은 이미 저장됐다. 일정 맞추기가 실패해도 승인 실패로 안내하지 않고, 다음 새로고침 때 다시 맞춘다
      try {
        showScheduleResult(await autoScheduleMatch(matchId));
      } catch (e) {
        console.error('autoSchedule error:', e);
      }
      setProcessingId(null);
      await fetchDashboard();
    } catch (error) {
      console.error('Error:', error);
      setProcessingId(null);
      toast.show('승인 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleReselectDates(matchId: string, dates: string[]) {
    if (!user) return;
    setDatesTarget(null);
    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);
      const { error } = await supabase
        .from('match_requests')
        .update(match?.isHopeful1 ? { available_dates_1: dates } : { available_dates_2: dates })
        .eq('id', matchId);
      if (error) throw error;
      const result = await autoScheduleMatch(matchId);
      if (result.status === 'no_overlap') toast.show('아직 겹치는 날짜가 없어요. 상대가 날짜를 고르면 다시 맞춰볼게요', 'info');
      else showScheduleResult(result);
      await fetchDashboard();
    } catch (error) {
      toast.show('날짜를 저장하지 못했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRejectMatch(matchId: string) {
    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);

      const { data: saved, error } = await supabase
        .from('match_requests')
        .update({ status: 'rejected' })
        .eq('id', matchId)
        .neq('status', 'rejected')
        .select('id');

      if (error) throw error;
      if (!saved?.length) {
        toast.show('이미 종료된 매칭이에요', 'info');
        setProcessingId(null);
        await fetchDashboard();
        return;
      }

      if (match?.connector_1_id) {
        await createNotification({
          userId: match.connector_1_id,
          type: 'match_rejected',
          title: '회원이 매칭을 거절했습니다',
          body: `${user?.name}님이 매칭 제안을 거절했습니다`,
          route: '/matching',
        });
      }
      if (match?.connector_2_id && match.connector_2_id !== match.connector_1_id) {
        await createNotification({
          userId: match.connector_2_id,
          type: 'match_rejected',
          title: '회원이 매칭을 거절했습니다',
          body: `${user?.name}님이 매칭 제안을 거절했습니다`,
          route: '/matching',
        });
      }

      toast.show('✓ 매칭을 거절했습니다', 'success');
      setProcessingId(null);
      await fetchDashboard();
    } catch (error) {
      console.error('Error:', error);
      setProcessingId(null);
      toast.show('거절 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleSubmitAfterCare(matchId: string, afterCareType: '신청' | '미신청' | '노쇼신고') {
    if (!user) return;

    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);
      const isHopeful1 = match?.isHopeful1;

      const updateData = isHopeful1
        ? { after_care_hopeful_1: afterCareType, after_care_requested_at_1: new Date().toISOString() }
        : { after_care_hopeful_2: afterCareType, after_care_requested_at_2: new Date().toISOString() };

      // 이미 마무리된 매칭이거나 이미 고른 경우에는 다시 저장하지 않는다 (오래된 화면에서 누른 경우)
      const { data: saved, error } = await supabase
        .from('match_requests')
        .update(updateData)
        .eq('id', matchId)
        .eq('settlement_completed', false)
        .is(isHopeful1 ? 'after_care_hopeful_1' : 'after_care_hopeful_2', null)
        .select('id');

      if (error) throw error;
      if (!saved?.length) {
        toast.show('이미 마무리된 매칭이에요', 'info');
        setProcessingId(null);
        await fetchDashboard();
        return;
      }

      toast.show('의사를 전달했어요', 'success');

      // 상대방이 이미 제출했는지는 화면에 남아있는 예전 상태가 아니라 방금 저장된 실제 DB 값으로 판단해야 한다
      // (두 회원이 서로 다른 기기에서 시차를 두고 제출하면 내 화면의 match는 상대방 제출 사실을 모를 수 있다)
      const { data: freshMatch } = await supabase
        .from('match_requests')
        .select('after_care_hopeful_1, after_care_hopeful_2')
        .eq('id', matchId)
        .single();

      // 노쇼 신고는 상대 응답을 기다리지 않고 바로 (정산 없이) 종료한다
      if (afterCareType === '노쇼신고' || (freshMatch?.after_care_hopeful_1 && freshMatch?.after_care_hopeful_2)) {
        const { data: settledNow, error: settleError } = await supabase.rpc('fn_settle_match', { p_match_id: matchId });
        if (settleError) {
          toast.show('마무리 처리 중 문제가 발생했습니다. 파트너에게 문의해주세요', 'error');
        } else if (afterCareType === '노쇼신고') {
          toast.show('노쇼 신고가 접수되어 매칭이 종료되었어요. 이용권은 차감되지 않아요', 'success');
        } else {
          toast.show('소개팅 결과가 나왔어요', 'success');
          // 두 회원이 거의 동시에 고르면 둘 다 여기까지 온다. 실제로 마무리한 쪽만 알린다
          if (settledNow) await notifyAfterCareResult(matchId, user.id);
        }
      }

      setProcessingId(null);
      await fetchDashboard();
    } catch (error) {
      console.error('Error:', error);
      setProcessingId(null);
      toast.show('애프터의사 저장 중 오류가 발생했습니다', 'error');
    }
  }

  // 운영자는 홈이 없다 (탭: 정산관리·설정)
  if (user?.role === 'operator') {
    return <Redirect href="/settlements" />;
  }

  if (loading) {
    return <SkeletonScreen />;
  }

  // 연결자 화면
  // 연결자 홈: 매칭의 현재 단계를 한 줄로

  if (user?.role === 'connector') {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const me = user.id;

    // 지금 할 일: 파트너가 직접 처리해야 하는 것만, 급한 순서로. 건마다 최대 3개를 바로 보여준다
    const pair = (m: any) => `${m.hopeful_1?.name ?? '회원'} ↔ ${m.hopeful_2?.name ?? '회원'}`;
    const focusMatch = (id: string) => () => router.push({ pathname: '/matching', params: { view: 'history', focus: id } });
    const consentList = matchingRequests.filter((m) => needsMyConsent(m, me));
    const scheduleList = matchingRequests.filter((m) => needsMyDate(m, me));
    const finishList = matchingRequests.filter((m) => isOverdueForMe(m, me));
    type TodoItem = { key: string; label: string; action: string; go: () => void };
    type Todo = TodoItem & { name: string; items: TodoItem[]; total: number };
    const goPending = () => router.push({ pathname: '/connectors', params: { tab: 'pending' } });
    const goStageList = (st: MatchStage) => () => router.push({ pathname: '/matching', params: { view: 'history', stage: st } });
    const todos: Todo[] = [
      pendingSignupCount > 0 && {
        key: 'signup', name: '가입 신청', label: `가입 신청 ${pendingSignupCount}건`, action: '승인하기', go: goPending, total: pendingSignupCount,
        items: pendingMembers.map((p) => ({ key: p.id, label: `${p.name}님`, action: '확인', go: goPending })),
      },
      consentList.length > 0 && {
        key: 'consent', name: '동맹 매칭 동의', label: `동맹 매칭 동의 ${consentList.length}건`, action: '확인하기', go: goStageList('consent'), total: consentList.length,
        items: consentList.slice(0, 3).map((m) => ({ key: m.id, label: pair(m), action: '동의 확인', go: focusMatch(m.id) })),
      },
      finishList.length > 0 && {
        key: 'finish', name: '지난 만남 완료 처리', label: `지난 만남 완료 처리 ${finishList.length}건`, action: '처리하기', go: () => router.push({ pathname: '/matching', params: { view: 'history', stage: 'overdue' } }), total: finishList.length,
        items: finishList.slice(0, 3).map((m) => ({ key: m.id, label: pair(m), action: '완료 처리', go: focusMatch(m.id) })),
      },
      scheduleList.length > 0 && {
        key: 'date', name: '만남 날짜 정하기', label: `만남 날짜 정하기 ${scheduleList.length}건`, action: '정하기', go: goStageList('date'), total: scheduleList.length,
        items: scheduleList.slice(0, 3).map((m) => ({ key: m.id, label: pair(m), action: '날짜 정하기', go: focusMatch(m.id) })),
      },
    ].filter(Boolean) as Todo[];

    // 다가오는 만남: 날짜와 상관없이 가까운 3개
    const upcoming = matchingRequests
      .filter((m) => m.meeting_scheduled_at && m.meeting_status !== 'completed' && new Date(m.meeting_scheduled_at) >= startOfToday)
      .sort((a, b) => new Date(a.meeting_scheduled_at).getTime() - new Date(b.meeting_scheduled_at).getTime())
      .slice(0, 3);

    // 기다리는 중: 진행 중인 매칭 가운데 '지금 할 일'에 없는 것 (회원·상대 파트너 차례)
    // 상대가 답해야 다음으로 넘어가는 매칭만 (만남 예정은 '다가오는 만남'에, 내 차례는 '할 일'에 있음)
    const waitingMatches = matchingRequests.filter((m) => isWaitingOnOthers(m, me));

    // 시안 A: 보라 카드에 오늘 할 일 수와 가장 급한 일 하나, 나머지는 한 줄씩
    const todoTotal = todos.reduce((n, t) => n + t.total, 0);
    const first = todos[0];
    const firstSub = first
      ? first.key === 'signup'
        ? pendingMembers.length ? `${pendingMembers[0].name}님${first.total > 1 ? ` 외 ${first.total - 1}명` : ''}` : ''
        : first.items[0] ? `${first.items[0].label}${first.total > 1 ? ` 외 ${first.total - 1}건` : ''}` : ''
      : '';
    const manwon = (n: number) => (n >= 10000 ? `${Math.round(n / 1000) / 10}만원` : `${n.toLocaleString()}원`);

    return (
      <ScrollView style={styles.aPage} refreshControl={pullRefresh}>
        <View style={styles.aTop}>
          <Text style={styles.aHi}>{user?.name}님, 안녕하세요</Text>
          <NotificationBell />
        </View>

        {/* 오늘 처리할 일: 보라 카드 (강조는 여기 하나) */}
        <View style={styles.aHero}>
          {first ? (
            <>
              <Text style={styles.aHeroK}>오늘 처리할 일</Text>
              <Text style={styles.aHeroN}>{todoTotal}건</Text>
              <View style={styles.aHeroTask}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aHeroTaskT}>{first.label}</Text>
                  {!!firstSub && <Text style={styles.aHeroTaskS} numberOfLines={1}>{firstSub}</Text>}
                </View>
                <TouchableOpacity style={styles.aHeroBtn} onPress={first.go} accessibilityLabel={`${first.label} ${first.action}`}>
                  <Text style={styles.aHeroBtnT}>{first.action}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.aHeroK}>오늘 처리할 일</Text>
              <Text style={styles.aHeroEmpty}>
                {approvedMemberCount === 0 ? '아직 내 회원이 없어요.\n초대장을 보내 회원을 모아보세요' : approvedMemberCount < 2 ? '매칭하려면 회원이 2명 이상 필요해요' : '처리할 일이 없어요 👍\n새 매칭을 제안해 보세요'}
              </Text>
              {approvedMemberCount < 2 ? (
                <TouchableOpacity style={styles.aHeroBtnWide} onPress={() => setShowInvite(true)}>
                  <Text style={styles.aHeroBtnT}>💌 초대장 보내기</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.aHeroBtnWide} onPress={() => router.push({ pathname: '/matching', params: { view: 'active' } })}>
                  <Text style={styles.aHeroBtnT}>매칭 제안하기</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* 나머지 할 일: 한 줄씩 */}
        {todos.length > 1 && (
          <View style={styles.aList}>
            {todos.slice(1).map((t) => (
              <TouchableOpacity key={t.key} style={styles.aRow} onPress={t.go} accessibilityLabel={`${t.label} ${t.action}`}>
                <Text style={styles.aRowT}>{t.name}</Text>
                <Text style={styles.aRowC}>{t.total} <Text style={styles.aChev}>›</Text></Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 새 파트너 시작 가이드: 첫 만남이 성사되면 사라진다 */}
        {startState && !startState.settled && (() => {
          const GOAL = 5;
          const steps = [
            { label: `회원 ${GOAL}명 초대하기`, sub: `지금 ${approvedMemberCount}명`, done: approvedMemberCount >= GOAL, go: () => setShowInvite(true) },
            { label: '첫 매칭 제안하기', sub: '어울릴 두 사람을 골라 제안해요', done: startState.proposed, go: () => router.push({ pathname: '/matching', params: { view: 'active' } }) },
            { label: '첫 만남 성사', sub: '만남 뒤 두 회원이 애프터를 고르면 완료', done: false, go: () => router.push({ pathname: '/matching', params: { view: 'history' } }) },
          ];
          const current = steps.findIndex((st) => !st.done);
          return (
            <View style={styles.guide} accessibilityLabel="시작 가이드">
              <View style={styles.guideHead}>
                <Text style={styles.guideTitle}>시작 가이드</Text>
                <Text style={styles.guideCount}>{steps.filter((st) => st.done).length}/{steps.length}</Text>
              </View>
              {steps.map((st, i) => (
                <TouchableOpacity key={st.label} style={styles.guideRow} onPress={st.go} disabled={st.done} accessibilityLabel={`시작 가이드 ${st.label}`}>
                  <View style={[styles.guideNum, st.done && styles.guideNumDone, i === current && styles.guideNumNow]}>
                    <Text style={[styles.guideNumT, st.done && styles.guideDoneT, i === current && styles.guideNumNowT]}>{st.done ? '✓' : i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.guideLabel, st.done && styles.guideDoneT, i === current && styles.guideLabelNow]}>{st.label}</Text>
                    {!st.done && <Text style={styles.guideSub}>{st.sub}</Text>}
                  </View>
                  {i === current && <Text style={styles.aChev}>›</Text>}
                </TouchableOpacity>
              ))}
            </View>
          );
        })()}

        {/* 현황 숫자 */}
        <View style={styles.aStats} accessibilityLabel="내 현황">
          <TouchableOpacity style={styles.aStat} onPress={() => router.push('/connectors')} accessibilityLabel={`내 회원 ${approvedMemberCount}명`}>
            <Text style={styles.aStatV}>{approvedMemberCount}명</Text>
            <Text style={styles.aStatL}>내 회원</Text>
          </TouchableOpacity>
          <View style={[styles.aStat, styles.aStatMid]} accessibilityLabel={`이번 달 성사 ${settledThisMonth}건`}>
            <Text style={styles.aStatV}>{settledThisMonth}건</Text>
            <Text style={styles.aStatL}>이번 달 성사</Text>
          </View>
          <TouchableOpacity style={styles.aStat} onPress={() => router.push({ pathname: '/profile', params: { open: 'settlements' } })} accessibilityLabel="출금 가능 금액">
            <Text style={styles.aStatV} numberOfLines={1} adjustsFontSizeToFit>{payoutAvailable === null ? '-' : manwon(payoutAvailable)}</Text>
            <Text style={styles.aStatL}>출금 가능</Text>
          </TouchableOpacity>
        </View>

        {/* 다가오는 만남 (2개) */}
        <Text style={styles.aH3}>다가오는 만남</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.aNone}>확정된 만남이 아직 없어요</Text>
        ) : (
          upcoming.slice(0, 2).map((m) => {
            const d = new Date(m.meeting_scheduled_at);
            return (
              <TouchableOpacity key={m.id} style={styles.aMeet} onPress={focusMatch(m.id)} accessibilityLabel={`${pair(m)} 만남 보기`}>
                <View style={styles.aDate}>
                  <Text style={styles.aDateD}>{d.getDate()}</Text>
                  <Text style={styles.aDateW}>{WEEK[d.getDay()]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aWho}>{pair(m)}</Text>
                  <Text style={styles.aWhen}>{meetTime(m.meeting_scheduled_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* 답을 기다리는 매칭 (한 줄) */}
        {waitingMatches.length > 0 && (
          <TouchableOpacity style={styles.aWait} onPress={() => router.push({ pathname: '/matching', params: { view: 'history', stage: 'waiting' } })} accessibilityLabel={`답을 기다리는 매칭 ${waitingMatches.length}건 보기`}>
            <Text style={styles.aWaitT}>답을 기다리는 매칭 {waitingMatches.length}건</Text>
            <Text style={styles.aChev}>›</Text>
          </TouchableOpacity>
        )}
        <View style={{ height: 32 }} />
        <InviteSheet visible={showInvite} onClose={() => setShowInvite(false)} partnerName={user.name} />
      </ScrollView>
    );
  }

  // 회원 화면 (시안: 맨 위 보라 카드에 지금 할 일 하나, 나머지는 한 줄씩)
  type Kind = 'answer' | 'after' | 'reselect' | 'review';
  const myView = receivedMatches.map((item) => {
    const myApproved = item.isHopeful1 ? item.hopeful_1_approved : item.hopeful_2_approved;
    const myAfterCare = item.isHopeful1 ? item.after_care_hopeful_1 : item.after_care_hopeful_2;
    const bothApproved = item.hopeful_1_approved && item.hopeful_2_approved;
    const noDateOverlap = !item.meeting_scheduled_at && item.available_dates_1?.length > 0 && item.available_dates_2?.length > 0 &&
      !earliestCommonDate(item.available_dates_1, item.available_dates_2);
    const ended = item.settlement_completed || !!item.closed_reason;
    const kind: Kind | null = ended ? null
      : !myApproved ? 'answer'
      : bothApproved && noDateOverlap ? 'reselect'
      : item.meeting_status === 'completed' && !myAfterCare ? 'after'
      : null;
    const review = item.meeting_status === 'completed' && !!myAfterCare && !reviewedMatchIds.includes(item.id);
    const upcoming = !ended && !kind && !!item.meeting_scheduled_at && item.meeting_status !== 'completed';
    return { item, kind, review, ended, upcoming, waiting: !ended && !kind && !upcoming };
  });
  const KIND: Record<Kind, { title: string; row: string; btn: string }> = {
    answer: { title: '새 소개가 왔어요', row: '새 소개', btn: '프로필 보고 답하기' },
    after: { title: '소개팅 어떠셨나요?', row: '소개팅 어떠셨나요?', btn: '답하기' },
    reselect: { title: '날짜를 다시 골라 주세요', row: '날짜 다시 고르기', btn: '날짜 다시 고르기' },
    review: { title: '파트너 후기를 남겨 주세요', row: '파트너 후기 남기기', btn: '후기 남기기' },
  };
  const ORDER: Kind[] = ['answer', 'after', 'reselect', 'review'];
  // 같은 할 일은 오래 기다린 것부터
  const byKind = (k: Kind) => myView.filter((v) => (k === 'review' ? v.review && !v.kind : v.kind === k)).map((v) => v.item)
    .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime());
  const tasks = ORDER.map((k) => ({ k, items: byKind(k) })).filter((t) => t.items.length > 0);
  const firstTask = tasks[0];
  const firstItem = firstTask?.items[0];
  const upcomingList = myView.filter((v) => v.upcoming).map((v) => v.item)
    .sort((a, b) => new Date(a.meeting_scheduled_at).getTime() - new Date(b.meeting_scheduled_at).getTime());
  const waitingList = myView.filter((v) => v.waiting && !(v.review)).map((v) => v.item);
  const pastList = myView.filter((v) => v.ended).map((v) => v.item);
  const partnerOf = (item: any) => partnerNames[item.isHopeful1 ? item.connector_1_id : item.connector_2_id];
  const isNew = receivedMatches.length === 0;
  const openTask = (k: Kind, item: any) => {
    if (k === 'answer') return setMatchSheet({ title: '새 소개', ids: [item.id], profileOf: item.id });
    if (k === 'reselect') return setDatesTarget({ matchId: item.id, mode: 'reselect' });
    setMatchSheet({ title: k === 'review' ? '소개 결과' : KIND[k].row, ids: [item.id] });
  };
  const openRow = (k: Kind, items: any[]) =>
    items.length === 1 ? openTask(k, items[0]) : setMatchSheet({ title: `${KIND[k].row} ${items.length}건`, ids: items.map((m) => m.id) });

  // 할 일이 없을 때: 처음 온 회원은 시작 순서대로 안내
  const idle = !firstTask
    ? isNew && profileGaps.length > 0
      ? { title: '프로필을 채워 주세요', sub: '사진과 자기소개가 있으면\n파트너가 소개하기 훨씬 쉬워요.', btn: '프로필 채우기', go: () => router.push({ pathname: '/profile', params: { open: 'profile' } }) }
      : myPartners.requested === 0
        ? { title: '파트너를 찾아보세요', sub: '파트너에게 가입 신청하면\n맞는 분을 소개받을 수 있어요.', btn: '파트너 찾아보기', go: () => router.push('/connectors') }
        : myPartners.approved === 0
          ? { title: '파트너 승인을 기다리고 있어요', sub: '승인되면 알림으로 알려드릴게요.' }
          : remainingSessions === 0
            ? { title: '이용권을 준비해 주세요', sub: '이용권이 있어야 파트너가\n소개를 시작할 수 있어요.', btn: '이용권 구매하기', go: () => router.push('/connectors') }
            : { title: '지금은 할 일이 없어요', sub: '파트너가 맞는 분을 찾고 있어요.\n새 소개가 오면 알림으로 알려드릴게요.' }
    : null;
  const steps = [
    { label: '프로필 채우기', done: profileGaps.length === 0 },
    { label: '파트너에게 가입 신청', done: myPartners.requested > 0 },
    { label: '이용권 준비하고 소개받기', done: (remainingSessions || 0) > 0 },
  ];
  const sheetItems = matchSheet ? receivedMatches.filter((m) => matchSheet.ids.includes(m.id)) : [];
  const sheetProfile = matchSheet?.profileOf ? receivedMatches.find((m) => m.id === matchSheet.profileOf) : null;

  const renderMatchCard = (item: any) => {
      const myApproved = item.isHopeful1 ? item.hopeful_1_approved : item.hopeful_2_approved;
      const myAfterCare = item.isHopeful1 ? item.after_care_hopeful_1 : item.after_care_hopeful_2;
      const noDateOverlap = !item.meeting_scheduled_at && item.available_dates_1?.length > 0 && item.available_dates_2?.length > 0 &&
        !earliestCommonDate(item.available_dates_1, item.available_dates_2);
      const bothApproved = item.hopeful_1_approved && item.hopeful_2_approved;

      return (
        <View style={styles.requestCard}>
          <View style={styles.requestHeader}>
            <Text style={styles.requestTitle}>
              {item.closed_reason
                ? '매칭 종료'
                : item.settlement_completed
                  ? '✓ 소개팅 완료'
                  : item.meeting_status === 'completed'
                    ? '💬 소개팅 어떠셨나요?'
                    : item.meeting_scheduled_at
                      ? '📅 소개팅 예정'
                      : '🤝 매칭 제안'}
            </Text>
            <Text style={styles.requestDate}>
              {new Date(item.created_at).toLocaleDateString('ko-KR')}
            </Text>
          </View>

          {item.partner && (
            <TouchableOpacity style={styles.partnerInfo} onPress={() => setMatchSheet((cur) => (cur ? { ...cur, profileOf: item.id } : cur))}>
              <Avatar photoUrls={item.partner.photo_urls} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerName}>{item.partner.name}</Text>
                <Text style={styles.partnerDetail}>
                  {[item.partner.age && `${item.partner.age}세`, item.partner.location].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={styles.partnerProfileLink}>프로필 보기 ›</Text>
            </TouchableOpacity>
          )}

          {/* Timeline */}
          <View style={styles.timeline}>
            {/* 1단계: 매칭 */}
            <View style={styles.timelineStep}>
              <View style={[styles.timelineCircle, styles.timelineComplete]}>
                <Text style={styles.timelineIcon}>✓</Text>
              </View>
              <Text style={styles.timelineLabel}>제안</Text>
            </View>

            <View style={styles.timelineLine} />

            {/* 2단계: 참여 의사 */}
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.timelineCircle,
                  myApproved ? styles.timelineComplete : styles.timelinePending,
                ]}
              >
                <Text style={styles.timelineIcon}>{myApproved ? '✓' : '•'}</Text>
              </View>
              <Text style={styles.timelineLabel}>참여</Text>
            </View>

            <View style={styles.timelineLine} />

            {/* 3단계: 애프터의사 */}
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.timelineCircle,
                  !bothApproved
                    ? styles.timelineDisabled
                    : myAfterCare
                      ? styles.timelineComplete
                      : styles.timelinePending,
                ]}
              >
                <Text style={styles.timelineIcon}>
                  {!bothApproved ? '-' : myAfterCare ? '✓' : '•'}
                </Text>
              </View>
              <Text style={styles.timelineLabel}>애프터</Text>
            </View>

            <View style={styles.timelineLine} />

            {/* 4단계: 종료 */}
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.timelineCircle,
                  !bothApproved
                    ? styles.timelineDisabled
                    : item.settlement_completed
                      ? styles.timelineComplete
                      : styles.timelinePending,
                ]}
              >
                <Text style={styles.timelineIcon}>
                  {!bothApproved ? '-' : item.settlement_completed ? '✓' : '•'}
                </Text>
              </View>
              <Text style={styles.timelineLabel}>종료</Text>
            </View>
          </View>

          {/* 2단계: 참여 의사 버튼 */}
          {!myApproved && (
            <View style={styles.requestActions}>
              <TouchableOpacity
                style={[styles.approveBtn, processingId === item.id && styles.buttonDisabled]}
                onPress={() => { setMatchSheet(null); setDatesTarget({ matchId: item.id, mode: 'approve' }); }}
                disabled={processingId !== null}
              >
                <Text style={styles.approveBtnText}>
                  {processingId === item.id ? '처리 중...' : '승인'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectBtn, processingId === item.id && styles.buttonDisabled]}
                onPress={async () => {
                  if (await confirm({ title: '매칭을 거절할까요?', message: '거절하면 되돌릴 수 없습니다.', confirmText: '거절', destructive: true })) handleRejectMatch(item.id);
                }}
                disabled={processingId !== null}
              >
                <Text style={styles.rejectBtnText}>
                  {processingId === item.id ? '처리 중...' : '거절'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 참여 의사 대기 */}
          {myApproved && !bothApproved && (
            <View style={styles.waitingMessage}>
              <Text style={styles.waitingText}>✓ 승인했습니다. 상대방의 승인을 기다리는 중입니다.</Text>
            </View>
          )}

          {/* 날짜가 겹치지 않음: 다시 고르기 */}
          {bothApproved && noDateOverlap && (
            <View style={styles.afterCareSection}>
              <Text style={styles.afterCareLabel}>상대와 가능한 날짜가 겹치지 않아요</Text>
              <TouchableOpacity
                style={[styles.findPartnerBtn, { marginTop: 10, alignSelf: 'stretch', alignItems: 'center' }, processingId === item.id && styles.buttonDisabled]}
                onPress={() => { setMatchSheet(null); setDatesTarget({ matchId: item.id, mode: 'reselect' }); }}
                disabled={processingId !== null}
              >
                <Text style={styles.findPartnerBtnText}>날짜 다시 고르기</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 3단계: 소개팅 진행 대기 */}
          {bothApproved && !noDateOverlap && item.meeting_status !== 'completed' && !item.after_care_hopeful_1 && !item.after_care_hopeful_2 && (
            item.meeting_scheduled_at ? (
              // 연락처는 화면에 보여주지 않고 담당 파트너와의 채팅으로만 전달된다
              <View style={styles.meetingBox}>
                <Text style={styles.meetingDate}>📅 {formatMeetingDate(item.meeting_scheduled_at)} 소개팅</Text>
                <Text style={styles.meetingHint}>상대 연락처를 채팅으로 보내드렸어요. 시간과 장소는 서로 연락해 정해주세요.</Text>
                <TouchableOpacity
                  style={styles.openChatBtn}
                  // 연락처가 온 담당 파트너와의 대화방을 바로 연다
                  onPress={() => { setMatchSheet(null); router.push({ pathname: '/chat', params: { with: item.isHopeful1 ? item.connector_1_id : item.connector_2_id } }); }}
                >
                  <Text style={styles.openChatBtnText}>채팅 확인하기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.waitingMessage}>
                <Text style={styles.waitingText}>
                  🎯 파트너가 소개팅 날짜를 정하는 중입니다
                </Text>
              </View>
            )
          )}

          {/* 3단계: 애프터의사 버튼 (소개팅 완료 후, 본인이 아직 선택 안 함) */}
          {item.meeting_status === 'completed' && !item.settlement_completed &&
          ((item.isHopeful1 && !item.after_care_hopeful_1) ||
            (!item.isHopeful1 && !item.after_care_hopeful_2)) && (
            <View style={styles.afterCareSection}>
              <Text style={styles.afterCareLabel}>소개팅은 어떠셨나요? 두 분 모두 고른 뒤에 결과를 알려드려요</Text>
              {!!item.meeting_completed_at && (
                <Text style={styles.afterCareDeadline}>
                  {formatDeadline(afterCareDeadline(item.meeting_completed_at))}까지 고르지 않으면 '이번이 마지막이에요'로 처리돼요
                </Text>
              )}
              <View style={styles.afterCareButtons}>
                <TouchableOpacity
                  style={[styles.afterCareBtn, styles.afterCarePrimary, processingId === item.id && styles.buttonDisabled]}
                  onPress={() => handleSubmitAfterCare(item.id, '신청')}
                  disabled={processingId !== null}
                >
                  <Text style={styles.afterCareBtnText}>
                    {processingId === item.id ? '처리 중...' : '또 만나고 싶어요'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.afterCareBtn, processingId === item.id && styles.buttonDisabled]}
                  onPress={() => handleSubmitAfterCare(item.id, '미신청')}
                  disabled={processingId !== null}
                >
                  <Text style={styles.afterCareBtnText}>
                    {processingId === item.id ? '처리 중...' : '이번이 마지막이에요'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.afterCareBtn, styles.afterCareDanger, processingId === item.id && styles.buttonDisabled]}
                  onPress={async () => {
                    if (await confirm({ title: '노쇼로 신고할까요?', message: '상대가 약속 장소에 나오지 않은 경우에만 신고해주세요. 신고 후에는 취소할 수 없습니다.', confirmText: '신고', destructive: true })) handleSubmitAfterCare(item.id, '노쇼신고');
                  }}
                  disabled={processingId !== null}
                >
                  <Text style={styles.afterCareBtnText}>
                    {processingId === item.id ? '처리 중...' : '상대가 안 나왔어요'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 애프터의사 완료 메시지 (본인이 이미 선택했을 때) */}
          {item.meeting_status === 'completed' &&
          (item.settlement_completed || (item.isHopeful1 && item.after_care_hopeful_1) || (!item.isHopeful1 && item.after_care_hopeful_2)) && (
            <View style={styles.waitingMessage}>
              <Text style={styles.waitingText}>
                {item.settlement_completed
                  ? item.closed_reason === 'no_show'
                    ? (item.isHopeful1 ? item.after_care_hopeful_1 : item.after_care_hopeful_2) === '노쇼신고'
                      ? '노쇼 신고가 접수되어 매칭이 종료되었어요. 이용권은 차감되지 않았어요.'
                      : '매칭이 종료되었어요. 이용권은 차감되지 않았어요.'
                    : item.after_care_hopeful_1 === '신청' && item.after_care_hopeful_2 === '신청'
                      ? '💞 상대도 다시 만나고 싶어해요! 채팅에서 받은 연락처로 다시 연락해보세요.'
                      : '이번 만남은 여기서 마무리되었어요. 좋은 인연을 계속 응원할게요.'
                  : item.after_care_hopeful_1 && item.after_care_hopeful_2
                    ? '두 분 모두 골랐어요. 결과를 정리하고 있으니 잠시 후 다시 확인해주세요.'
                    : `✓ 의사를 전달했어요. 상대방도 고르면 결과를 알려드릴게요.${item.meeting_completed_at ? ` (늦어도 ${formatDeadline(afterCareDeadline(item.meeting_completed_at))})` : ''}`}
              </Text>
            </View>
          )}

          {/* 파트너 후기: 내 애프터 의사를 낸 뒤 한 번 남길 수 있다 */}
          {item.meeting_status === 'completed' && !!myAfterCare && (
            reviewedMatchIds.includes(item.id) ? (
              <Text style={styles.reviewDoneText}>✓ 파트너 후기를 남겼어요</Text>
            ) : (
              <TouchableOpacity
                style={styles.reviewBtn}
                onPress={() => { setMatchSheet(null); setReviewTarget({ matchId: item.id, connectorId: item.isHopeful1 ? item.connector_1_id : item.connector_2_id }); }}
              >
                <Text style={styles.reviewBtnText}>파트너 후기 남기기</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      );
  };

  return (
    <ScrollView style={styles.aPage} refreshControl={pullRefresh}>
      <View style={styles.aTop}>
        <Text style={styles.aHi}>{user?.name}님, {isNew && profileGaps.length > 0 ? '반가워요 👋' : '안녕하세요'}</Text>
        <NotificationBell />
      </View>

      {/* 지금 할 일: 보라 카드 (강조는 여기 하나) */}
      <View style={styles.aHero}>
        {isNew && idle?.btn && profileGaps.length > 0 && <Text style={styles.mBadge}>시작하기</Text>}
        <Text style={styles.aHeroK}>지금 할 일</Text>
        {firstTask ? (
          <>
            <Text style={styles.mHeroT}>{KIND[firstTask.k].title}</Text>
            {firstTask.k === 'answer' && firstItem.partner ? (
              <View style={styles.aHeroTask}>
                <Avatar photoUrls={firstItem.partner.photo_urls} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.aHeroTaskT} numberOfLines={1}>
                    {firstItem.partner.name}님{firstItem.partner.age ? ` · ${firstItem.partner.age}세` : ''}
                  </Text>
                  <Text style={styles.aHeroTaskS} numberOfLines={1}>
                    {[firstItem.partner.job, firstItem.partner.location, partnerOf(firstItem) && `${partnerOf(firstItem)} 추천`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.mHeroSub} numberOfLines={2}>
                {firstTask.k === 'review'
                  ? `${partnerOf(firstItem) ? `${partnerOf(firstItem)} 파트너` : '파트너'}가 ${firstItem.partner?.name ? `${firstItem.partner.name}님을 ` : ''}소개해 줬어요`
                  : firstItem.partner?.name ? `${firstItem.partner.name}님과의 소개` : ''}{firstTask.items.length > 1 ? ` 외 ${firstTask.items.length - 1}건` : ''}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.aHeroBtnWide, { marginTop: 14 }]}
              onPress={() => openTask(firstTask.k, firstItem)}
              accessibilityLabel={KIND[firstTask.k].btn}
            >
              <Text style={styles.mHeroBtnT}>{KIND[firstTask.k].btn}</Text>
            </TouchableOpacity>
          </>
        ) : idle && (
          <>
            <Text style={styles.mHeroT}>{idle.title}</Text>
            <Text style={styles.mHeroSub}>{idle.sub}</Text>
            {idle.btn && (
              <TouchableOpacity style={[styles.aHeroBtnWide, { marginTop: 16 }]} onPress={idle.go} accessibilityLabel={idle.btn}>
                <Text style={styles.mHeroBtnT}>{idle.btn}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* 나머지 할 일: 한 줄씩 (첫 할 일의 남은 건도 포함) */}
      {firstTask && (tasks.length > 1 || firstTask.items.length > 1) && (
        <View style={styles.aList}>
          {tasks.map((t, i) => {
            const rest = i === 0 ? t.items.slice(1) : t.items;
            if (rest.length === 0) return null;
            return (
              <TouchableOpacity key={t.k} style={styles.aRow} onPress={() => openRow(t.k, rest)} accessibilityLabel={`${KIND[t.k].row} ${rest.length}건`}>
                <Text style={styles.aRowT}>{KIND[t.k].row}</Text>
                <Text style={styles.aRowC}>{rest.length} <Text style={styles.aChev}>›</Text></Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* 처음 온 회원: 시작 순서 */}
      {isNew && (
        <View style={styles.mSteps}>
          {steps.map((st, i) => (
            <View key={st.label} style={styles.mStep}>
              <View style={[styles.mStepNum, st.done && styles.mStepNumDone]}>
                <Text style={[styles.mStepNumT, st.done && styles.mStepDoneT]}>{st.done ? '✓' : i + 1}</Text>
              </View>
              <Text style={[styles.mStepT, st.done && styles.mStepDoneT]}>{st.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 남은 이용권 (2단계 안에 확인) */}
      <TouchableOpacity
        style={styles.mCredit}
        onPress={() => router.push({ pathname: '/profile', params: { open: 'credits' } })}
        accessibilityLabel={`남은 이용권 ${remainingSessions ?? 0}회`}
      >
        <Text style={styles.mCreditL}>남은 이용권</Text>
        <Text style={styles.mCreditV}>
          {remainingSessions === null ? '-' : `${remainingSessions}회`}
          {freeSessions > 0 && <Text style={styles.mCreditS}>  무료 {freeSessions}회 포함</Text>} ›
        </Text>
      </TouchableOpacity>

      {/* 프로필이 비어 있으면 (보라 카드에서 안내하지 않을 때만) 한 줄로 */}
      {!isNew && profileGaps.length > 0 && (
        <TouchableOpacity style={styles.aWait} onPress={() => router.push({ pathname: '/profile', params: { open: 'profile' } })} accessibilityLabel="프로필 채우기">
          <Text style={styles.aWaitT}>프로필을 채우면 소개받기 쉬워요 · {profileGaps.join(' · ')}</Text>
          <Text style={styles.aChev}>›</Text>
        </TouchableOpacity>
      )}

      {/* 다가오는 소개팅 */}
      {upcomingList.length > 0 && (
        <>
          <Text style={styles.aH3}>다가오는 소개팅</Text>
          {upcomingList.slice(0, 2).map((m) => {
            const d = new Date(m.meeting_scheduled_at);
            return (
              <TouchableOpacity key={m.id} style={styles.aMeet} onPress={() => setMatchSheet({ title: '소개팅 예정', ids: [m.id] })} accessibilityLabel={`${m.partner?.name ?? '상대'}님 소개팅 보기`}>
                <View style={styles.aDate}>
                  <Text style={styles.aDateD}>{d.getDate()}</Text>
                  <Text style={styles.aDateW}>{WEEK[d.getDay()]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aWho}>{m.partner?.name ?? '상대'}님</Text>
                  <Text style={styles.aWhen}>{meetTime(m.meeting_scheduled_at)} · 연락처는 채팅에</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {upcomingList.length > 2 && (
            <TouchableOpacity style={styles.aMeetMore} onPress={() => setMatchSheet({ title: `다가오는 소개팅 ${upcomingList.length}건`, ids: upcomingList.map((m) => m.id) })}>
              <Text style={styles.aWaitT}>+ {upcomingList.length - 2}건 더 보기</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* 답을 기다리는 소개 · 지난 소개 (회색 한 줄) */}
      {waitingList.length > 0 && (
        <TouchableOpacity style={styles.aWait} onPress={() => setMatchSheet({ title: `답을 기다리는 소개 ${waitingList.length}건`, ids: waitingList.map((m) => m.id) })} accessibilityLabel={`답을 기다리는 소개 ${waitingList.length}건 보기`}>
          <Text style={styles.aWaitT}>답을 기다리는 소개 {waitingList.length}건</Text>
          <Text style={styles.aChev}>›</Text>
        </TouchableOpacity>
      )}
      {pastList.length > 0 && (
        <TouchableOpacity style={styles.aWait} onPress={() => setMatchSheet({ title: `지난 소개 ${pastList.length}건`, ids: pastList.map((m) => m.id) })} accessibilityLabel={`지난 소개 ${pastList.length}건 보기`}>
          <Text style={styles.aWaitT}>지난 소개 {pastList.length}건</Text>
          <Text style={styles.aChev}>›</Text>
        </TouchableOpacity>
      )}
      <View style={{ height: 32 }} />

      <ReviewSheet
        visible={reviewTarget !== null}
        partnerName={reviewPartnerName}
        metName={reviewTarget ? receivedMatches.find((m: any) => m.id === reviewTarget.matchId)?.partner?.name : undefined}
        onClose={() => setReviewTarget(null)}
        onSubmit={async (rating, content) => {
          if (!reviewTarget || !user) return;
          const { error } = await submitReview({ ...reviewTarget, hopefulId: user.id, rating, content });
          if (error) {
            toast.show('후기 등록 중 오류가 발생했습니다', 'error');
            return;
          }
          setReviewedMatchIds((prev) => [...prev, reviewTarget.matchId]);
          setReviewTarget(null);
          toast.show('후기를 남겼어요. 감사합니다', 'success');
        }}
      />

      <AvailableDatesSheet
        visible={datesTarget !== null}
        onClose={() => setDatesTarget(null)}
        confirmLabel={datesTarget?.mode === 'reselect' ? '다시 맞춰보기' : '승인하기'}
        initialDates={(() => {
          const m = receivedMatches.find((x) => x.id === datesTarget?.matchId);
          // 지난 날짜는 다시 고를 수 없으므로 빼고 보여준다
          const today = toDateKey(new Date());
          return m ? ((m.isHopeful1 ? m.available_dates_1 : m.available_dates_2) ?? []).filter((d: string) => d >= today) : [];
        })()}
        onConfirm={(dates) => {
          if (!datesTarget) return;
          if (datesTarget.mode === 'approve') handleApproveMatch(datesTarget.matchId, dates);
          else handleReselectDates(datesTarget.matchId, dates);
        }}
      />

      {/* 소개 카드 / 상대 프로필 시트 */}
      <BottomSheet visible={matchSheet !== null} onClose={() => setMatchSheet(null)} title={sheetProfile ? '소개팅 상대' : matchSheet?.title}>
        {sheetProfile ? (
          <>
            {matchSheet && matchSheet.ids.length > 0 && !(matchSheet.ids.length === 1 && matchSheet.profileOf && sheetItems[0] && !(sheetItems[0].isHopeful1 ? sheetItems[0].hopeful_1_approved : sheetItems[0].hopeful_2_approved)) && (
              <TouchableOpacity onPress={() => setMatchSheet({ ...matchSheet, profileOf: undefined })} style={styles.mBack} accessibilityLabel="소개 카드로 돌아가기">
                <Text style={styles.mBackT}>‹ 소개 카드로</Text>
              </TouchableOpacity>
            )}
            {sheetProfile.partner && <MemberProfileView member={sheetProfile.partner} />}
            {/* 아직 답하지 않은 소개: 프로필을 보고 바로 답한다 */}
            {!(sheetProfile.isHopeful1 ? sheetProfile.hopeful_1_approved : sheetProfile.hopeful_2_approved) && (
              <View style={[styles.requestActions, { marginTop: 16 }]}>
                <TouchableOpacity
                  style={[styles.approveBtn, processingId === sheetProfile.id && styles.buttonDisabled]}
                  onPress={() => { const id = sheetProfile.id; setMatchSheet(null); setDatesTarget({ matchId: id, mode: 'approve' }); }}
                  disabled={processingId !== null}
                >
                  <Text style={styles.approveBtnText}>{processingId === sheetProfile.id ? '처리 중...' : '승인'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectBtn, processingId === sheetProfile.id && styles.buttonDisabled]}
                  onPress={async () => {
                    const id = sheetProfile.id;
                    if (await confirm({ title: '매칭을 거절할까요?', message: '거절하면 되돌릴 수 없습니다.', confirmText: '거절', destructive: true })) { setMatchSheet(null); handleRejectMatch(id); }
                  }}
                  disabled={processingId !== null}
                >
                  <Text style={styles.rejectBtnText}>{processingId === sheetProfile.id ? '처리 중...' : '거절'}</Text>
                </TouchableOpacity>
              </View>
            )}
            {sheetProfile.partner && <SafetyActions targetId={sheetProfile.partner.id} targetName={sheetProfile.partner.name} context="match" />}
          </>
        ) : (
          sheetItems.map((item) => <View key={item.id}>{renderMatchCard(item)}</View>)
        )}
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  aPage: { flex: 1, backgroundColor: '#fff' },
  aTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 6 },
  aHi: { fontSize: 15, color: '#6b6b6b' },
  aHero: { marginHorizontal: 20, marginTop: 12, backgroundColor: '#5B21FF', borderRadius: 22, padding: 22 },
  aHeroK: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  aHeroN: { fontSize: 40, fontWeight: '800', color: '#fff', marginTop: 4, marginBottom: 14 },
  aHeroEmpty: { fontSize: 18, fontWeight: '700', color: '#fff', lineHeight: 26, marginTop: 8, marginBottom: 16 },
  aHeroTask: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 14, gap: 12 },
  aHeroTaskT: { fontSize: 16, fontWeight: '700', color: '#fff' },
  aHeroTaskS: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 3 },
  aHeroBtn: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  aHeroBtnWide: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  aHeroBtnT: { color: '#5B21FF', fontSize: 14, fontWeight: '700' },
  aList: { marginHorizontal: 20, marginTop: 10 },
  aRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: '#F1F1F3' },
  aRowT: { fontSize: 16, color: '#191919' },
  aRowC: { fontSize: 16, fontWeight: '700', color: '#5B21FF' },
  aChev: { fontSize: 16, fontWeight: '400', color: '#C4C4C8' },
  aStats: { flexDirection: 'row', marginHorizontal: 20, marginTop: 24, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F1F1F3' },
  aStat: { flex: 1, alignItems: 'center' },
  aStatMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#F1F1F3' },
  aStatV: { fontSize: 19, fontWeight: '700', color: '#191919' },
  aStatL: { fontSize: 12, color: '#8E8E93', marginTop: 3 },
  aH3: { fontSize: 17, fontWeight: '700', color: '#191919', marginHorizontal: 22, marginTop: 26, marginBottom: 10 },
  aNone: { fontSize: 14, color: '#8E8E93', marginHorizontal: 22, marginBottom: 6 },
  aMeet: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20, marginBottom: 10 },
  aDate: { width: 52, alignItems: 'center', backgroundColor: '#F4F1FF', borderRadius: 12, paddingVertical: 8 },
  aDateD: { fontSize: 18, fontWeight: '700', color: '#5B21FF' },
  aDateW: { fontSize: 11, color: '#5B21FF' },
  aWho: { fontSize: 15, fontWeight: '600', color: '#191919' },
  aWhen: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  aWait: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 14, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1F1F3' },
  aWaitT: { fontSize: 14, color: '#8E8E93', flexShrink: 1 },
  guide: { marginHorizontal: 20, marginTop: 18, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E9E2FF', backgroundColor: '#FBFAFF' },
  guideHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  guideTitle: { fontSize: 15, fontWeight: '700', color: '#191919' },
  guideCount: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  guideNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#EEEEF0', alignItems: 'center', justifyContent: 'center' },
  guideNumDone: { backgroundColor: '#EEEEF0' },
  guideNumNow: { backgroundColor: '#5B21FF' },
  guideNumT: { fontSize: 13, fontWeight: '700', color: '#8E8E93' },
  guideNumNowT: { color: '#fff' },
  guideLabel: { fontSize: 15, color: '#555' },
  guideLabelNow: { color: '#191919', fontWeight: '700' },
  guideDoneT: { color: '#B0B0B5' },
  guideSub: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  aMeetMore: { marginHorizontal: 22, paddingVertical: 6 },
  mBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', color: '#fff', fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginBottom: 8, overflow: 'hidden' },
  mHeroT: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 6, marginBottom: 14, lineHeight: 34 },
  mHeroSub: { fontSize: 14, color: 'rgba(255,255,255,0.9)', lineHeight: 21 },
  mHeroBtnT: { color: '#5B21FF', fontSize: 15, fontWeight: '700' },
  mSteps: { marginHorizontal: 20, marginTop: 14 },
  mStep: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  mStepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F4F1FF', alignItems: 'center', justifyContent: 'center' },
  mStepNumDone: { backgroundColor: '#EEEEF0' },
  mStepNumT: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  mStepT: { fontSize: 15, color: '#555' },
  mStepDoneT: { color: '#B0B0B5' },
  mCredit: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginTop: 18, paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#F7F7F9' },
  mCreditL: { fontSize: 15, color: '#555' },
  mCreditV: { fontSize: 16, fontWeight: '700', color: '#191919' },
  mCreditS: { fontSize: 12, fontWeight: '400', color: '#8E8E93' },
  mBack: { paddingVertical: 6, marginBottom: 6, alignSelf: 'flex-start' },
  mBackT: { fontSize: 14, color: '#5B21FF', fontWeight: '600' },
  findPartnerBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 20,
  },
  findPartnerBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  requestCard: {
    backgroundColor: '#F7F4FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  requestHeader: {
    marginBottom: 12,
  },
  requestTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  requestDate: {
    fontSize: 12,
    color: '#999',
  },
  partnerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  meetingBox: {
    backgroundColor: '#F1ECFF',
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  meetingDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5B21FF',
  },
  openChatBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#5B21FF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  openChatBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5B21FF',
  },
  meetingHint: {
    fontSize: 12,
    color: '#666',
  },
  partnerProfileLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5B21FF',
    paddingVertical: 6,
    paddingLeft: 12,
  },
  partnerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  partnerDetail: {
    fontSize: 12,
    color: '#666',
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
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
  timelineDisabled: {
    backgroundColor: '#f0f0f0',
    borderColor: '#e0e0e0',
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
  requestActions: {
    flexDirection: 'row',
    gap: 10,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#5B21FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 12,
    alignItems: 'center',
  },
  rejectBtnText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  waitingMessage: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  waitingText: {
    color: '#5B21FF',
    fontSize: 12,
    fontWeight: '500',
  },
  reviewBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reviewBtnText: {
    color: '#5B21FF',
    fontSize: 14,
    fontWeight: '600',
  },
  reviewDoneText: {
    marginTop: 10,
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  afterCareSection: {
    backgroundColor: '#F9F0FF',
    borderRadius: 8,
    padding: 12,
  },
  afterCareLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
    fontWeight: '500',
  },
  afterCareDeadline: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
  },
  afterCareButtons: {
    gap: 8,
  },
  afterCareBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 12,
    alignItems: 'center',
  },
  afterCarePrimary: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  afterCareDanger: {
    borderColor: '#FF6B6B',
  },
  afterCareBtnText: {
    fontWeight: '600',
    fontSize: 12,
    color: '#333',
  },
});
