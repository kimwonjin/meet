import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Connector states
  const [myMembers, setMyMembers] = useState<any[]>([]);
  const [matchingRequests, setMatchingRequests] = useState<any[]>([]);
  const [pendingSignupCount, setPendingSignupCount] = useState(0);

  // Hopeful states
  const [receivedMatches, setReceivedMatches] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      fetchDashboard();
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchDashboard();
      }
    }, [user])
  );

  async function fetchDashboard() {
    try {
      if (user?.role === 'connector') {
        // 연결자: 내 회원 조회 (같은 회원에 대해 중복 요청 행이 있을 수 있어 hopeful_id 기준으로 중복 제거)
        const { data: myDataRaw } = await supabase
          .from('hopeful_requests')
          .select('*')
          .eq('connector_id', user!.id)
          .eq('status', 'approved');

        const myData = (myDataRaw || []).filter(
          (req: any, index: number, arr: any[]) => arr.findIndex((r: any) => r.hopeful_id === req.hopeful_id) === index
        );

        const hopefulIds = (myData || []).map((req: any) => req.hopeful_id);
        const { data: myHopefuls } = await supabase
          .from('users')
          .select('*')
          .in('id', hopefulIds);

        const members = (myData || []).map((req: any) => {
          const hopeful = (myHopefuls || []).find((h: any) => h.id === req.hopeful_id);
          return { ...hopeful, request_id: req.id };
        });
        setMyMembers(members);

        // 처리 대기 요약: 가입 대기 건수
        const { count: pendingCount } = await supabase
          .from('hopeful_requests')
          .select('*', { count: 'exact', head: true })
          .eq('connector_id', user!.id)
          .eq('status', 'pending');
        setPendingSignupCount(pendingCount || 0);

        // 연결자: 내가 제안한 매칭들 조회
        const { data: matchData } = await supabase
          .from('match_requests')
          .select('*')
          .or(`connector_1_id.eq.${user!.id},connector_2_id.eq.${user!.id}`);

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
          };
        });

        setMatchingRequests(matches);
      } else {
        // 희望자: 받은 매칭 제안 조회
        const { data: reqData } = await supabase
          .from('match_requests')
          .select('*')
          .or(`hopeful_1_id.eq.${user!.id},hopeful_2_id.eq.${user!.id}`)
          .in('status', ['pending', 'approved', 'completed']);

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
            settlement_completed: r.settlement_completed,
            isHopeful1,
            created_at: r.created_at,
            connector_1_id: r.connector_1_id,
            connector_2_id: r.connector_2_id,
          };
        });

        setReceivedMatches(matches);
      }
    } catch (error) {
      console.error('fetchDashboard error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveMatch(matchId: string) {
    if (!user) return;

    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);
      const isHopeful1 = match?.isHopeful1;

      const updateData = isHopeful1
        ? { hopeful_1_approved: true }
        : { hopeful_2_approved: true };

      const { error } = await supabase
        .from('match_requests')
        .update(updateData)
        .eq('id', matchId);

      if (error) throw error;

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
      setProcessingId(null);
      await fetchDashboard();
    } catch (error) {
      console.error('Error:', error);
      setProcessingId(null);
      toast.show('승인 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleRejectMatch(matchId: string) {
    setProcessingId(matchId);
    try {
      const match = receivedMatches.find((m) => m.id === matchId);

      const { error } = await supabase
        .from('match_requests')
        .update({ status: 'rejected' })
        .eq('id', matchId);

      if (error) throw error;

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

      const { error } = await supabase
        .from('match_requests')
        .update(updateData)
        .eq('id', matchId);

      if (error) throw error;

      toast.show(`✓ 애프터의사가 저장되었습니다: ${afterCareType}`, 'success');

      // 상대방이 이미 제출했는지는 화면에 남아있는 예전 상태가 아니라 방금 저장된 실제 DB 값으로 판단해야 한다
      // (두 회원이 서로 다른 기기에서 시차를 두고 제출하면 내 화면의 match는 상대방 제출 사실을 모를 수 있다)
      const { data: freshMatch } = await supabase
        .from('match_requests')
        .select('after_care_hopeful_1, after_care_hopeful_2')
        .eq('id', matchId)
        .single();

      if (freshMatch?.after_care_hopeful_1 && freshMatch?.after_care_hopeful_2) {
        const { error: settleError } = await supabase.rpc('fn_settle_match', { p_match_id: matchId });
        if (settleError) {
          toast.show(settleError.message || '정산 처리 중 문제가 발생했습니다', 'error');
        } else {
          toast.show('✓ 정산이 완료되었습니다', 'success');
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  // 연결자 화면
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
      <ScrollView style={styles.container}>
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
              onPress={() => router.push('/matching')}
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
                <Text style={styles.scheduleCardTime}>
                  {new Date(m.meeting_scheduled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
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
                    {new Date(m.meeting_scheduled_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}{' '}
                    {new Date(m.meeting_scheduled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <Text style={styles.scheduleListNames}>{m.hopeful_1?.name} ↔ {m.hopeful_2?.name}</Text>
                  {new Date(m.meeting_scheduled_at) < now && m.meeting_status !== 'completed' && (
                    <Text style={styles.scheduleOverdueBadge}>일정 경과</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 내 회원 섹션 (조회 전용 - 매칭 제안은 회원관리 탭에서) */}
        {myMembers.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>승인된 회원이 없습니다</Text>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>내 회원 ({myMembers.length})</Text>
            </View>

            <FlatList
              data={myMembers}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.memberCard}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    <Text style={styles.memberAge}>{item.location}</Text>
                  </View>
                </View>
              )}
            />
          </View>
        )}

        {/* 진행 중인 매칭 섹션 */}
        {matchingRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>진행 중인 매칭</Text>
            <FlatList
              data={matchingRequests}
              scrollEnabled={false}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.matchCard}>
                  <View style={styles.matchHeader}>
                    <Text style={styles.matchTitle}>
                      {item.hopeful_1?.name} ↔ {item.hopeful_2?.name}
                    </Text>
                    <Text style={styles.matchDate}>
                      {new Date(item.created_at).toLocaleDateString('ko-KR')}
                    </Text>
                  </View>

                  {/* Timeline */}
                  <View style={styles.timeline}>
                    {/* 1단계: 매칭 */}
                    <View style={styles.timelineStep}>
                      <View style={[styles.timelineCircle, styles.timelineComplete]}>
                        <Text style={styles.timelineIcon}>✓</Text>
                      </View>
                      <Text style={styles.timelineLabel}>매칭</Text>
                    </View>

                    <View style={styles.timelineLine} />

                    {/* 2단계: 회원1 승인 */}
                    <View style={styles.timelineStep}>
                      <View
                        style={[
                          styles.timelineCircle,
                          item.hopeful_1_approved ? styles.timelineComplete : styles.timelinePending,
                        ]}
                      >
                        <Text style={styles.timelineIcon}>
                          {item.hopeful_1_approved ? '✓' : '•'}
                        </Text>
                      </View>
                      <Text style={styles.timelineLabel}>{item.hopeful_1?.name || '회원1'}</Text>
                    </View>

                    <View style={styles.timelineLine} />

                    {/* 3단계: 회원2 승인 */}
                    <View style={styles.timelineStep}>
                      <View
                        style={[
                          styles.timelineCircle,
                          item.hopeful_2_approved ? styles.timelineComplete : styles.timelinePending,
                        ]}
                      >
                        <Text style={styles.timelineIcon}>
                          {item.hopeful_2_approved ? '✓' : '•'}
                        </Text>
                      </View>
                      <Text style={styles.timelineLabel}>{item.hopeful_2?.name || '회원2'}</Text>
                    </View>

                    <View style={styles.timelineLine} />

                    {/* 4단계: 완료 */}
                    <View style={styles.timelineStep}>
                      <View
                        style={[
                          styles.timelineCircle,
                          item.hopeful_1_approved && item.hopeful_2_approved
                            ? styles.timelineComplete
                            : styles.timelinePending,
                        ]}
                      >
                        <Text style={styles.timelineIcon}>
                          {item.hopeful_1_approved && item.hopeful_2_approved ? '✓' : '•'}
                        </Text>
                      </View>
                      <Text style={styles.timelineLabel}>완료</Text>
                    </View>
                  </View>
                </View>
              )}
            />
          </View>
        )}
      </ScrollView>
    );
  }

  // 희望자 화면
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>안녕하세요, {user?.name}님 👋</Text>
            <Text style={styles.subGreeting}>받은 매칭 제안</Text>
          </View>
          <NotificationBell />
        </View>
      </View>

      {receivedMatches.length === 0 ? (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>받은 매칭이 없습니다</Text>
        </View>
      ) : (
        <View style={styles.section}>
          <FlatList
            data={receivedMatches}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const myApproved = item.isHopeful1 ? item.hopeful_1_approved : item.hopeful_2_approved;
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
                    <View style={styles.partnerInfo}>
                      <Text style={styles.partnerName}>{item.partner.name}</Text>
                      <Text style={styles.partnerDetail}>{item.partner.location}</Text>
                    </View>
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
                            : item.after_care_hopeful_1 || item.after_care_hopeful_2
                              ? styles.timelineComplete
                              : styles.timelinePending,
                        ]}
                      >
                        <Text style={styles.timelineIcon}>
                          {!bothApproved ? '-' : item.after_care_hopeful_1 ? '✓' : '•'}
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
                        onPress={() => handleApproveMatch(item.id)}
                        disabled={processingId !== null}
                      >
                        <Text style={styles.approveBtnText}>
                          {processingId === item.id ? '처리 중...' : '승인'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectBtn, processingId === item.id && styles.buttonDisabled]}
                        onPress={() => handleRejectMatch(item.id)}
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

                  {/* 3단계: 소개팅 진행 대기 */}
                  {bothApproved && item.meeting_status !== 'completed' && !item.after_care_hopeful_1 && !item.after_care_hopeful_2 && (
                    <View style={styles.waitingMessage}>
                      <Text style={styles.waitingText}>🎯 소개팅 일정을 기다리는 중입니다...</Text>
                    </View>
                  )}

                  {/* 3단계: 애프터의사 버튼 (소개팅 완료 후, 본인이 아직 선택 안 함) */}
                  {item.meeting_status === 'completed' &&
                  ((item.isHopeful1 && !item.after_care_hopeful_1) ||
                    (!item.isHopeful1 && !item.after_care_hopeful_2)) && (
                    <View style={styles.afterCareSection}>
                      <Text style={styles.afterCareLabel}>소개팅을 마친 후 의사를 선택하세요</Text>
                      <View style={styles.afterCareButtons}>
                        <TouchableOpacity
                          style={[styles.afterCareBtn, styles.afterCarePrimary, processingId === item.id && styles.buttonDisabled]}
                          onPress={() => handleSubmitAfterCare(item.id, '신청')}
                          disabled={processingId !== null}
                        >
                          <Text style={styles.afterCareBtnText}>
                            {processingId === item.id ? '처리 중...' : '신청'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.afterCareBtn, processingId === item.id && styles.buttonDisabled]}
                          onPress={() => handleSubmitAfterCare(item.id, '미신청')}
                          disabled={processingId !== null}
                        >
                          <Text style={styles.afterCareBtnText}>
                            {processingId === item.id ? '처리 중...' : '미신청'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.afterCareBtn, styles.afterCareDanger, processingId === item.id && styles.buttonDisabled]}
                          onPress={() => handleSubmitAfterCare(item.id, '노쇼신고')}
                          disabled={processingId !== null}
                        >
                          <Text style={styles.afterCareBtnText}>
                            {processingId === item.id ? '처리 중...' : '노쇼신고'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* 애프터의사 완료 메시지 (본인이 이미 선택했을 때) */}
                  {item.meeting_status === 'completed' &&
                  ((item.isHopeful1 && item.after_care_hopeful_1) ||
                    (!item.isHopeful1 && item.after_care_hopeful_2)) && (
                    <View style={styles.waitingMessage}>
                      <Text style={styles.waitingText}>
                        {item.settlement_completed
                          ? '✓ 정산이 완료되었습니다. 매칭이 종료되었습니다.'
                          : '✓ 애프터의사가 저장되었습니다. 상대방의 응답을 기다리는 중입니다.'}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
      )}
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
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  selectedCard: {
    backgroundColor: '#F0E8FF',
    borderWidth: 2,
    borderColor: '#5B21FF',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  memberAge: {
    fontSize: 12,
    color: '#999',
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
    backgroundColor: '#fff8f0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9500',
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
    marginBottom: 12,
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
    backgroundColor: '#E8F5FF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  waitingText: {
    color: '#0084FF',
    fontSize: 12,
    fontWeight: '500',
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
  afterCareButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  afterCareBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 10,
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
