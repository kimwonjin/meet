import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  TextInput,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { getCredit } from '@/lib/payments';
import AlliancesScreen from './alliances';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';

type Segment = 'internal' | 'ally' | 'alliance';

export default function MatchingScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const [matchRequests, setMatchRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [segment, setSegment] = useState<Segment>('internal');

  const [ownMembers, setOwnMembers] = useState<{ id: string; name: string }[]>([]);
  const [allyConnectors, setAllyConnectors] = useState<{ id: string; name: string }[]>([]);
  const [selectedAllyConnector, setSelectedAllyConnector] = useState<{ id: string; name: string } | null>(null);
  const [allyConnectorMembers, setAllyConnectorMembers] = useState<{ id: string; name: string }[]>([]);
  const [selectedForMatch, setSelectedForMatch] = useState<{ id: string; connectorId: string }[]>([]);
  const [proposing, setProposing] = useState(false);

  useEffect(() => {
    if (user) {
      fetchMatches();
      fetchOwnMembers();
      fetchAllyConnectors();
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchMatches();
        fetchOwnMembers();
        fetchAllyConnectors();
      }
    }, [user])
  );

  async function fetchMatches() {
    try {
      if (user?.role === 'connector') {
        // 내가 제안한 매칭 조회 (승인 이상 상태)
        let matchData: any[] = [];

        const { data: myProposals } = await supabase
          .from('match_requests')
          .select('*')
          .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
          .in('status', ['pending', 'approved', 'completed']);

        matchData = [...(myProposals || [])];

        // 내 회원이 포함된 매칭 조회
        const { data: requests } = await supabase
          .from('hopeful_requests')
          .select('hopeful_id')
          .eq('connector_id', user.id)
          .eq('status', 'approved');

        const hopefulIds = (requests || []).map((r: any) => r.hopeful_id);

        if (hopefulIds.length > 0) {
          const { data: memberMatches1 } = await supabase
            .from('match_requests')
            .select('*')
            .in('hopeful_1_id', hopefulIds)
            .in('status', ['pending', 'approved', 'completed']);

          const { data: memberMatches2 } = await supabase
            .from('match_requests')
            .select('*')
            .in('hopeful_2_id', hopefulIds)
            .in('status', ['pending', 'approved', 'completed']);

          const existingIds = new Set(matchData.map((m: any) => m.id));
          const allMemberMatches = [...(memberMatches1 || []), ...(memberMatches2 || [])];
          const newMatches = allMemberMatches.filter((m: any) => !existingIds.has(m.id));
          matchData = [...matchData, ...newMatches];
        }

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
            meeting_scheduled_at: m.meeting_scheduled_at,
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
    const { data: users } = await supabase.from('users').select('id, name').in('id', ids);
    setOwnMembers((users || []).map((u: any) => ({ id: u.id, name: u.name })));
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
    const { data: users } = await supabase.from('users').select('id, name').in('id', ids);
    setAllyConnectorMembers((users || []).map((u: any) => ({ id: u.id, name: u.name })));
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

  async function handleProposeMatch() {
    if (!user || selectedForMatch.length !== 2) return;

    setProposing(true);
    try {
      const [a, b] = selectedForMatch;
      const [creditA, creditB] = await Promise.all([
        getCredit(a.id, a.connectorId),
        getCredit(b.id, b.connectorId),
      ]);

      if (creditA.credit <= 0 || creditB.credit <= 0) {
        toast.show('이용권이 없는 회원이 있어 매칭할 수 없습니다', 'error');
        return;
      }

      const connector1Consented = a.connectorId === user.id;
      const connector2Consented = b.connectorId === user.id;

      const { error } = await supabase.from('match_requests').insert([{
        hopeful_1_id: a.id,
        connector_1_id: a.connectorId,
        hopeful_2_id: b.id,
        connector_2_id: b.connectorId,
        status: 'pending',
        proposer_connector_id: user.id,
        connector_1_consented: connector1Consented,
        connector_2_consented: connector2Consented,
      }]);
      if (error) throw error;

      if (connector1Consented && connector2Consented) {
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
      toast.show(error?.message || '매칭 제안 중 오류가 발생했습니다', 'error');
    } finally {
      setProposing(false);
    }
  }

  async function handleConsentApprove(matchId: string) {
    if (!user) return;

    const match = matchRequests.find(m => m.id === matchId);
    if (!match) return;

    const updates: any = {};
    if (match.connector_1_id === user.id) updates.connector_1_consented = true;
    if (match.connector_2_id === user.id) updates.connector_2_consented = true;
    if (Object.keys(updates).length === 0) return;

    setProcessingId(matchId);
    try {
      const { error } = await supabase
        .from('match_requests')
        .update(updates)
        .eq('id', matchId);

      if (error) throw error;

      const finalC1 = updates.connector_1_consented ?? match.connector_1_consented;
      const finalC2 = updates.connector_2_consented ?? match.connector_2_consented;
      if (finalC1 && finalC2 && match.hopeful_1?.id && match.hopeful_2?.id) {
        await Promise.all([
          createNotification({ userId: match.hopeful_1.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
          createNotification({ userId: match.hopeful_2.id, type: 'match_proposed', title: '새로운 매칭 제안이 도착했습니다', route: '/home' }),
        ]);
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

  async function handleSetSchedule(matchId: string) {
    const raw = (scheduleInputs[matchId] || '').trim();
    if (!raw) {
      toast.show('일정을 입력해주세요 (예: 2026-09-15 19:00)', 'error');
      return;
    }
    const parsed = new Date(raw.replace(' ', 'T'));
    if (isNaN(parsed.getTime())) {
      toast.show('날짜 형식을 확인해주세요 (예: 2026-09-15 19:00)', 'error');
      return;
    }

    setProcessingId(matchId);
    try {
      const { error } = await supabase
        .from('match_requests')
        .update({ meeting_scheduled_at: parsed.toISOString() })
        .eq('id', matchId);

      if (error) throw error;

      toast.show('✓ 만남 일정을 확정했습니다', 'success');
      await fetchMatches();
    } catch (error) {
      console.error('Error:', error);
      toast.show('일정 저장 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleUpdateMeetingStatus(matchId: string, newStatus: 'in_progress' | 'completed') {
    if (!user) return;

    setProcessingId(matchId);
    try {
      const { error } = await supabase
        .from('match_requests')
        .update({ meeting_status: newStatus })
        .eq('id', matchId);

      if (error) throw error;

      const statusMsg = newStatus === 'in_progress' ? '만남 중' : '만남 완료';
      toast.show(`✓ 소개팅이 ${statusMsg}으로 변경되었습니다`, 'success');
      setProcessingId(null);
      await fetchMatches();
    } catch (error) {
      console.error('Error:', error);
      setProcessingId(null);
      toast.show('상태 업데이트 중 오류가 발생했습니다', 'error');
    }
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
  const allyMatches = [...matchRequests]
    .filter((m) => m.connector_1_id !== m.connector_2_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  function renderMemberChips(
    members: { id: string; name: string }[],
    connectorId: string
  ) {
    return (
      <View style={styles.memberChipWrap}>
        {members.map((m) => {
          const isSelected = selectedForMatch.some((s) => s.id === m.id);
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberChip, isSelected && styles.memberChipSelected]}
              onPress={() => toggleSelectForMatch(m.id, connectorId)}
            >
              <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
                {isSelected ? '✓ ' : ''}{m.name}
              </Text>
            </TouchableOpacity>
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
          <Text style={styles.createTitle}>동맹 연결자를 선택하세요</Text>
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
            <Text style={styles.backLink}>‹ 동맹 연결자 다시 선택</Text>
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
                <Text style={styles.timelineLabel}>연결자동의</Text>
              </View>

              <View style={styles.timelineLine} />
            </>
          )}
          {/* 1단계: 매칭 */}
          <View style={styles.timelineStep}>
            <View style={[styles.timelineCircle, styles.timelineComplete]}>
              <Text style={styles.timelineIcon}>✓</Text>
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
              <View style={[styles.halfCircle, item.meeting_status === 'completed' ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.meeting_status === 'completed' ? '✓' : '•'}
                </Text>
              </View>
              <View style={[styles.halfCircle, item.meeting_status === 'completed' ? styles.timelineComplete : styles.timelinePending]}>
                <Text style={styles.timelineIcon}>
                  {item.meeting_status === 'completed' ? '✓' : '•'}
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
            <TouchableOpacity
              style={[styles.actionBtn, processingId === item.id && styles.buttonDisabled]}
              onPress={() => handleConsentApprove(item.id)}
              disabled={processingId !== null}
            >
              <Text style={styles.actionBtnText}>
                {processingId === item.id ? '처리 중...' : '✓ 승인'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.statusMessage}>
              <Text style={styles.statusMessageText}>상대 연결자의 동의를 기다리는 중입니다</Text>
            </View>
          )
        ) : (
          <>
            {!(item.hopeful_1_approved && item.hopeful_2_approved) && (
              <View style={styles.statusMessage}>
                <Text style={styles.statusMessageText}>회원 참여 승인 대기 중입니다</Text>
              </View>
            )}

            {item.hopeful_1_approved && item.hopeful_2_approved && item.meeting_status === 'announced' && (
              item.meeting_scheduled_at ? (
                <View style={styles.scheduleConfirmedRow}>
                  <Text style={styles.scheduleConfirmedText}>
                    📅 {new Date(item.meeting_scheduled_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <TouchableOpacity
                    style={[styles.actionBtn, processingId === item.id && styles.buttonDisabled]}
                    onPress={() => handleUpdateMeetingStatus(item.id, 'in_progress')}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.actionBtnText}>
                      {processingId === item.id ? '처리 중...' : '🎯 만남중으로 변경'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.scheduleInputRow}>
                  <TextInput
                    style={styles.scheduleInput}
                    placeholder="만남 일정 (예: 2026-09-15 19:00)"
                    placeholderTextColor="#bbb"
                    value={scheduleInputs[item.id] || ''}
                    onChangeText={(text) => setScheduleInputs((prev) => ({ ...prev, [item.id]: text }))}
                  />
                  <TouchableOpacity
                    style={[styles.scheduleConfirmBtn, processingId === item.id && styles.buttonDisabled]}
                    onPress={() => handleSetSchedule(item.id)}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.scheduleConfirmBtnText}>일정 확정</Text>
                  </TouchableOpacity>
                </View>
              )
            )}

            {item.hopeful_1_approved && item.hopeful_2_approved && item.meeting_status === 'in_progress' && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.completeBtn, processingId === item.id && styles.buttonDisabled]}
                onPress={() => handleUpdateMeetingStatus(item.id, 'completed')}
                disabled={processingId !== null}
              >
                <Text style={styles.completeBtnText}>
                  {processingId === item.id ? '처리 중...' : '✓ 만남 완료'}
                </Text>
              </TouchableOpacity>
            )}

            {item.meeting_status === 'completed' && (
              <View style={styles.statusMessage}>
                <Text style={styles.statusMessageText}>
                  ✓ 소개팅 완료
                  {item.settlement_completed
                    ? ' - 정산 완료'
                    : item.after_care_hopeful_1 && item.after_care_hopeful_2
                      ? ' - 정산 처리 중 (이용권 확인 필요)'
                      : ' - 애프터의사 대기 중'}
                </Text>
              </View>
            )}
          </>
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
        ] as { key: Segment; label: string }[]).map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.segmentBtn, segment === s.key && styles.segmentBtnActive]}
            onPress={() => setSegment(s.key)}
          >
            <Text style={[styles.segmentBtnText, segment === s.key && styles.segmentBtnTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
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
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
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
  scheduleInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  scheduleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 12,
    color: '#333',
  },
  scheduleConfirmBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  scheduleConfirmBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  scheduleConfirmedRow: {
    marginTop: 8,
  },
  scheduleConfirmedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5B21FF',
    marginBottom: 8,
    textAlign: 'center',
  },
  actionBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  completeBtn: {
    backgroundColor: '#10B981',
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
  statusMessageText: {
    color: '#5B21FF',
    fontWeight: '500',
    fontSize: 12,
  },
});
