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
  FlatList,
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
import ReviewSheet from '@/components/ReviewSheet';
import { fetchMyReviewedMatchIds, submitReview } from '@/lib/reviews';

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
  const [profilePartner, setProfilePartner] = useState<any | null>(null);
  const [approvedMemberCount, setApprovedMemberCount] = useState(0);
  const [profileGaps, setProfileGaps] = useState<string[]>([]);
  const [showInvite, setShowInvite] = useState(false);
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
          };
        });

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
          !(me?.photo_urls?.length) && '사진',
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
  function matchStatusText(m: any) {
    const cross = m.connector_1_id !== m.connector_2_id;
    if (cross && !(m.connector_1_consented && m.connector_2_consented)) return '파트너 동의 대기';
    if (!(m.hopeful_1_approved && m.hopeful_2_approved)) {
      return `회원 승인 대기 (${[m.hopeful_1_approved, m.hopeful_2_approved].filter(Boolean).length}/2)`;
    }
    if (!m.meeting_scheduled_at) return '만남 날짜 조율 중';
    if (m.meeting_status !== 'completed') return `📅 ${formatMeetingDate(m.meeting_scheduled_at)} 만남 예정`;
    if (m.after_care_hopeful_1 && m.after_care_hopeful_2) return '결과 정리 중';
    return `애프터 응답 대기 (${[m.after_care_hopeful_1, m.after_care_hopeful_2].filter(Boolean).length}/2)`;
  }

  if (user?.role === 'connector') {
    const pendingMatchApprovalCount = matchingRequests.filter(
      (m) => m.status !== 'rejected' && !(m.hopeful_1_approved && m.hopeful_2_approved)
    ).length;

    const scheduledMatches = [...matchingRequests]
      .filter((m) => m.meeting_scheduled_at)
      .sort((a, b) => new Date(a.meeting_scheduled_at).getTime() - new Date(b.meeting_scheduled_at).getTime());

    const now = new Date();
    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const todayMatches = scheduledMatches.filter((m) => isSameDay(new Date(m.meeting_scheduled_at), now));

    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const hasSchedule = scheduledMatches.some((m) => isSameDay(new Date(m.meeting_scheduled_at), d));
      return { date: d, hasSchedule, isToday: i === 0 };
    });

    return (
      <ScrollView style={styles.container} refreshControl={pullRefresh}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.greeting}>안녕하세요, {user?.name}님 👋</Text>
              <Text style={styles.subGreeting}>회원 매칭</Text>
            </View>
            <NotificationBell />
          </View>
        </View>

        {/* 처리 대기 요약 */}
        {(pendingSignupCount > 0 || pendingMatchApprovalCount > 0) && (
          <View style={styles.summarySection}>
            <TouchableOpacity
              style={styles.summaryCard}
              onPress={() => router.push('/connectors')}
            >
              <Text style={styles.summaryCardValue}>{pendingSignupCount}건</Text>
              <Text style={styles.summaryCardLabel}>가입신청 대기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.summaryCard}
              onPress={() => router.push({ pathname: '/matching', params: { view: 'history' } })}
            >
              <Text style={styles.summaryCardValue}>{pendingMatchApprovalCount}건</Text>
              <Text style={styles.summaryCardLabel}>매칭 승인대기</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 일정 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>오늘의 일정</Text>
          </View>
          {todayMatches.length === 0 ? (
            <Text style={styles.placeholderText}>오늘 예정된 만남이 없습니다</Text>
          ) : (
            todayMatches.map((m) => (
              <View key={m.id} style={styles.scheduleCard}>
                <Text style={styles.scheduleCardTime}>오늘</Text>
                <Text style={styles.scheduleCardNames}>{m.hopeful_1?.name} ↔ {m.hopeful_2?.name}</Text>
              </View>
            ))
          )}

          <View style={styles.weekStrip}>
            {weekDays.map(({ date, hasSchedule, isToday }, i) => (
              <View key={i} style={styles.weekDay}>
                <Text style={[styles.weekDayLabel, isToday && styles.weekDayLabelToday]}>
                  {['일', '월', '화', '수', '목', '금', '토'][date.getDay()]}
                </Text>
                <View style={[styles.weekDayCircle, isToday && styles.weekDayCircleToday]}>
                  <Text style={[styles.weekDayDate, isToday && styles.weekDayDateToday]}>{date.getDate()}</Text>
                </View>
                {hasSchedule && <View style={styles.weekDayDot} />}
              </View>
            ))}
          </View>

          {scheduledMatches.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.scheduleListTitle}>확정 일정</Text>
              {scheduledMatches.map((m) => (
                <View key={m.id} style={styles.scheduleListRow}>
                  <Text style={styles.scheduleListDate}>
                    {formatMeetingDate(m.meeting_scheduled_at)}
                  </Text>
                  <Text style={styles.scheduleListNames}>{m.hopeful_1?.name} ↔ {m.hopeful_2?.name}</Text>
                  {new Date(m.meeting_scheduled_at).setHours(0, 0, 0, 0) < new Date(now).setHours(0, 0, 0, 0) && m.meeting_status !== 'completed' && (
                    <Text style={styles.scheduleOverdueBadge}>일정 경과</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 진행 중인 매칭 섹션 */}
        {matchingRequests.length === 0 ? (
          approvedMemberCount < 2 ? (
            // 회원이 모자라면 매칭 제안 대신 회원을 모으는 방법을 먼저 안내한다
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                {approvedMemberCount === 0 ? '아직 내 회원이 없어요' : '매칭하려면 회원이 2명 이상 필요해요'}
              </Text>
              <Text style={[styles.placeholderHint, { textAlign: 'center', paddingHorizontal: 24, marginBottom: 4 }]}>초대장을 보내면 받은 사람이 가입할 때 나에게 바로 연결돼요</Text>
              <TouchableOpacity style={styles.findPartnerBtn} onPress={() => setShowInvite(true)}>
                <Text style={styles.findPartnerBtnText}>💌 초대장 보내기</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>진행 중인 매칭이 없습니다</Text>
            <TouchableOpacity style={styles.findPartnerBtn} onPress={() => router.push({ pathname: '/matching', params: { view: 'active' } })}>
              <Text style={styles.findPartnerBtnText}>매칭 제안하기</Text>
            </TouchableOpacity>
          </View>
          )
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>진행 중인 매칭 ({matchingRequests.length})</Text>
            {matchingRequests.map((item) => {
              const cross = item.connector_1_id !== item.connector_2_id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.activeMatchRow}
                  // 매칭 탭의 매칭내역에서 이 매칭 카드로 바로 이동
                  onPress={() => router.push({ pathname: '/matching', params: { view: 'history', focus: item.id } })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeMatchNames}>
                      {item.hopeful_1?.name} ↔ {item.hopeful_2?.name}
                      {cross ? '  · 동맹' : ''}
                    </Text>
                    <Text style={styles.activeMatchStatus}>{matchStatusText(item)}</Text>
                  </View>
                  <Text style={styles.activeMatchArrow}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <InviteSheet visible={showInvite} onClose={() => setShowInvite(false)} partnerName={user.name} />
      </ScrollView>
    );
  }

  // 회원 화면
  return (
    <ScrollView style={styles.container} refreshControl={pullRefresh}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>안녕하세요, {user?.name}님 👋</Text>
            <Text style={styles.subGreeting}>받은 매칭 제안</Text>
          </View>
          <NotificationBell />
        </View>
      </View>

      <TouchableOpacity
        style={styles.creditRow}
        onPress={() => router.push({ pathname: '/profile', params: { open: 'credits' } })}
      >
        <Text style={styles.creditLabel}>남은 이용권</Text>
        <Text style={styles.creditValue}>
          {remainingSessions === null ? '-' : `${remainingSessions}회`} ›
        </Text>
      </TouchableOpacity>

      {profileGaps.length > 0 && (
        <TouchableOpacity style={styles.profileNudge} onPress={() => router.push({ pathname: '/profile', params: { open: 'profile' } })}>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileNudgeTitle}>프로필을 채우면 소개받기 쉬워요</Text>
            <Text style={styles.profileNudgeSub}>아직 비어 있어요: {profileGaps.join(' · ')}</Text>
          </View>
          <Text style={styles.profileNudgeLink}>채우기 ›</Text>
        </TouchableOpacity>
      )}

      {receivedMatches.length === 0 ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>받은 매칭이 없습니다</Text>
          <Text style={styles.placeholderHint}>파트너에게 연락하면 맞는 분을 소개받을 수 있어요</Text>
          <TouchableOpacity style={styles.findPartnerBtn} onPress={() => router.push('/connectors')}>
            <Text style={styles.findPartnerBtnText}>파트너 찾아보기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.section}>
          <FlatList
            data={receivedMatches}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const myApproved = item.isHopeful1 ? item.hopeful_1_approved : item.hopeful_2_approved;
              const myAfterCare = item.isHopeful1 ? item.after_care_hopeful_1 : item.after_care_hopeful_2;
              const noDateOverlap = !item.meeting_scheduled_at && item.available_dates_1?.length > 0 && item.available_dates_2?.length > 0 &&
                !earliestCommonDate(item.available_dates_1, item.available_dates_2);
              const bothApproved = item.hopeful_1_approved && item.hopeful_2_approved;

              return (
                <View style={styles.requestCard}>
                  <View style={styles.requestHeader}>
                    <Text style={styles.requestTitle}>🤝 매칭 제안</Text>
                    <Text style={styles.requestDate}>
                      {new Date(item.created_at).toLocaleDateString('ko-KR')}
                    </Text>
                  </View>

                  {item.partner && (
                    <TouchableOpacity style={styles.partnerInfo} onPress={() => setProfilePartner(item.partner)}>
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
                        onPress={() => setDatesTarget({ matchId: item.id, mode: 'approve' })}
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
                        onPress={() => setDatesTarget({ matchId: item.id, mode: 'reselect' })}
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
                          onPress={() => router.push({ pathname: '/chat', params: { with: item.isHopeful1 ? item.connector_1_id : item.connector_2_id } })}
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
                        onPress={() => setReviewTarget({ matchId: item.id, connectorId: item.isHopeful1 ? item.connector_1_id : item.connector_2_id })}
                      >
                        <Text style={styles.reviewBtnText}>파트너 후기 남기기</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              );
            }}
          />
        </View>
      )}

      <ReviewSheet
        visible={reviewTarget !== null}
        partnerName={reviewPartnerName}
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

      <BottomSheet visible={profilePartner !== null} onClose={() => setProfilePartner(null)} title="소개팅 상대">
        {profilePartner && (
          <>
            <MemberProfileView member={profilePartner} />
            <SafetyActions targetId={profilePartner.id} targetName={profilePartner.name} context="match" />
          </>
        )}
      </BottomSheet>
    </ScrollView>
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
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  subGreeting: {
    fontSize: 14,
    color: '#666',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  summarySection: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#F1ECFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  summaryCardValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#5B21FF',
    marginBottom: 4,
  },
  summaryCardLabel: {
    fontSize: 12,
    color: '#666',
  },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1ECFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  scheduleCardTime: {
    fontSize: 13,
    fontWeight: '800',
    color: '#5B21FF',
  },
  scheduleCardNames: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  weekDay: {
    alignItems: 'center',
    gap: 6,
  },
  weekDayLabel: {
    fontSize: 11,
    color: '#999',
  },
  weekDayLabelToday: {
    color: '#5B21FF',
    fontWeight: '700',
  },
  weekDayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekDayCircleToday: {
    backgroundColor: '#5B21FF',
  },
  weekDayDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  weekDayDateToday: {
    color: '#fff',
  },
  weekDayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#5B21FF',
  },
  scheduleListTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
  },
  scheduleListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
  },
  scheduleListDate: {
    fontSize: 11,
    color: '#999',
    width: 90,
  },
  scheduleListNames: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  scheduleOverdueBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E53935',
  },
  matchBtn: {
    backgroundColor: '#5B21FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  matchBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  profileNudge: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#D9CCFF', backgroundColor: '#FBFAFF' },
  profileNudgeTitle: { fontSize: 14, fontWeight: '700', color: '#333' },
  profileNudgeSub: { fontSize: 12, color: '#888', marginTop: 3 },
  profileNudgeLink: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  placeholderText: {
    fontSize: 16,
    color: '#999',
  },
  placeholderHint: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 6,
  },
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
  creditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
  },
  creditLabel: {
    fontSize: 14,
    color: '#666',
  },
  creditValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  selectedCard: {
    backgroundColor: '#F0E8FF',
    borderWidth: 2,
    borderColor: '#5B21FF',
  },
  checkmark: {
    fontSize: 20,
    color: '#5B21FF',
    fontWeight: '700',
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
  activeMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
  },
  activeMatchNames: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  activeMatchStatus: {
    fontSize: 13,
    color: '#5B21FF',
    marginTop: 4,
  },
  activeMatchArrow: {
    fontSize: 22,
    color: '#bbb',
    marginLeft: 8,
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
