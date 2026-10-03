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
import BottomSheet from '@/components/BottomSheet';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { createNotification } from '@/lib/notifications';

export default function AlliancesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [otherConnectors, setOtherConnectors] = useState<any[]>([]);
  const [alliances, setAlliances] = useState<any[]>([]);
  const [selectedAlly, setSelectedAlly] = useState<any | null>(null);
  const [poolStats, setPoolStats] = useState<any | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [allianceProcessingId, setAllianceProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAlliances();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAlliances();
    }, [])
  );

  async function fetchAlliances() {
    if (!user) return;
    try {
      const { data: allConnectors } = await supabase.from('connectors').select('*').eq('status', 'approved');
      const otherConnectorIds = (allConnectors || []).map((c: any) => c.id).filter((id: string) => id !== user.id);
      const { data: otherConnUsers } = await supabase
        .from('users')
        .select('id, name')
        .in('id', otherConnectorIds.length ? otherConnectorIds : ['00000000-0000-0000-0000-000000000000']);
      const others = (allConnectors || [])
        .filter((c: any) => c.id !== user.id)
        .map((c: any) => ({ ...c, name: (otherConnUsers || []).find((u: any) => u.id === c.id)?.name }));
      setOtherConnectors(others);

      const { data: allianceRows } = await supabase
        .from('connector_alliances')
        .select('*')
        .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
        .in('status', ['PENDING', 'ACTIVE']);
      setAlliances(allianceRows || []);
    } catch (error) {
      console.error('Alliances fetch error:', error);
    } finally {
      setLoading(false);
    }
  }

  function getAllianceWith(otherId: string) {
    return alliances.find((a) => a.connector_1_id === otherId || a.connector_2_id === otherId);
  }

  async function handleRequestAlliance(otherId: string) {
    if (!user) return;
    setAllianceProcessingId(otherId);
    try {
      const { error } = await supabase.from('connector_alliances').insert([
        { connector_1_id: user.id, connector_2_id: otherId, status: 'PENDING', requested_by: user.id },
      ]);
      if (error) throw error;

      await createNotification({
        userId: otherId,
        type: 'alliance_requested',
        title: '새로운 동맹 요청이 도착했습니다',
        body: `${user.name}님이 동맹을 요청했습니다`,
        route: '/matching',
      });

      toast.show('✓ 동맹을 요청했습니다', 'success');
      await fetchAlliances();
    } catch (error) {
      toast.show('동맹 요청 중 오류가 발생했습니다', 'error');
    } finally {
      setAllianceProcessingId(null);
    }
  }

  async function handleAcceptAlliance(allianceId: string) {
    setAllianceProcessingId(allianceId);
    try {
      const alliance = alliances.find((a) => a.id === allianceId);

      const { error } = await supabase
        .from('connector_alliances')
        .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
        .eq('id', allianceId);
      if (error) throw error;

      if (alliance?.requested_by) {
        await createNotification({
          userId: alliance.requested_by,
          type: 'alliance_accepted',
          title: '동맹 요청이 수락되었습니다',
          body: `${user?.name}님이 동맹 요청을 수락했습니다`,
          route: '/matching',
        });
      }

      toast.show('✓ 동맹을 수락했습니다', 'success');
      await fetchAlliances();
    } catch (error) {
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setAllianceProcessingId(null);
    }
  }

  async function handleTerminateAlliance(allianceId: string) {
    setAllianceProcessingId(allianceId);
    try {
      const alliance = alliances.find((a) => a.id === allianceId);
      const wasPending = alliance?.status === 'PENDING';

      const { error } = await supabase
        .from('connector_alliances')
        .update({ status: 'TERMINATED', updated_at: new Date().toISOString() })
        .eq('id', allianceId);
      if (error) throw error;

      if (wasPending && alliance?.requested_by && alliance.requested_by !== user?.id) {
        await createNotification({
          userId: alliance.requested_by,
          type: 'alliance_rejected',
          title: '동맹 요청이 거절되었습니다',
          body: `${user?.name}님이 동맹 요청을 거절했습니다`,
          route: '/matching',
        });
      }

      toast.show('동맹을 해지했습니다', 'info');
      await fetchAlliances();
    } catch (error) {
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setAllianceProcessingId(null);
    }
  }

  async function handleViewAlly(conn: any) {
    if (!user) return;
    setSelectedAlly(conn);
    setLoadingStats(true);
    setPoolStats(null);
    try {
      const { data, error } = await supabase.rpc('fn_get_pool_stats', {
        p_target_connector_id: conn.id,
        p_requester_id: user.id,
      });
      if (error) throw error;
      setPoolStats(data);
    } catch (error) {
      setPoolStats({ available: false, reason: '통계를 불러오지 못했습니다' });
    } finally {
      setLoadingStats(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>동맹관리</Text>
      </View>

      {otherConnectors.length === 0 ? (
        <View style={styles.emptyTab}>
          <Text style={styles.placeholderText}>다른 연결자가 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={otherConnectors}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const alliance = getAllianceWith(item.id);
            const isActive = alliance?.status === 'ACTIVE';
            const isIncoming = alliance?.status === 'PENDING' && alliance.requested_by !== user?.id;
            const isOutgoing = alliance?.status === 'PENDING' && alliance.requested_by === user?.id;

            return (
              <View style={styles.card}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => handleViewAlly(item)} activeOpacity={0.7}>
                  <View style={styles.connTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>💼</Text>
                    </View>
                    <View style={styles.connInfo}>
                      <Text style={styles.name}>{item.name}</Text>
                      <Text style={styles.desc}>{isActive ? '동맹 중 · ' : ''}프로필 보기 ›</Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={styles.meta}>
                  {isActive ? (
                    <>
                      <TouchableOpacity
                        style={styles.chatBtn}
                        onPress={() => router.push({ pathname: '/chat', params: { with: item.id, name: item.name } })}
                      >
                        <Text style={styles.chatBtnText}>💬 채팅</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectBtn, allianceProcessingId === alliance.id && styles.buttonDisabled]}
                        onPress={async () => {
                          if (await confirm({ title: '동맹을 해지할까요?', message: '해지하면 서로의 회원 풀을 더 이상 볼 수 없습니다.', confirmText: '해지', destructive: true })) handleTerminateAlliance(alliance.id);
                        }}
                        disabled={allianceProcessingId !== null}
                      >
                        <Text style={styles.rejectBtnText}>{allianceProcessingId === alliance.id ? '처리 중...' : '동맹 해지'}</Text>
                      </TouchableOpacity>
                    </>
                  ) : isIncoming ? (
                    <>
                      <TouchableOpacity
                        style={[styles.approveBtn, allianceProcessingId === alliance.id && styles.buttonDisabled]}
                        onPress={() => handleAcceptAlliance(alliance.id)}
                        disabled={allianceProcessingId !== null}
                      >
                        <Text style={styles.approveBtnText}>{allianceProcessingId === alliance.id ? '처리 중...' : '동맹 수락'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectBtn, allianceProcessingId === alliance.id && styles.buttonDisabled]}
                        onPress={() => handleTerminateAlliance(alliance.id)}
                        disabled={allianceProcessingId !== null}
                      >
                        <Text style={styles.rejectBtnText}>거절</Text>
                      </TouchableOpacity>
                    </>
                  ) : isOutgoing ? (
                    <>
                      <Text style={styles.approvedStatusBadge}>요청됨</Text>
                      <TouchableOpacity
                        style={[styles.rejectBtn, allianceProcessingId === alliance.id && styles.buttonDisabled]}
                        onPress={() => handleTerminateAlliance(alliance.id)}
                        disabled={allianceProcessingId !== null}
                      >
                        <Text style={styles.rejectBtnText}>취소</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={[styles.approveBtn, allianceProcessingId === item.id && styles.buttonDisabled]}
                      onPress={() => handleRequestAlliance(item.id)}
                      disabled={allianceProcessingId !== null}
                    >
                      <Text style={styles.approveBtnText}>{allianceProcessingId === item.id ? '처리 중...' : '동맹 요청'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* 회원 풀 통계 바텀시트 */}
      <BottomSheet visible={!!selectedAlly} onClose={() => setSelectedAlly(null)}>
            <View>
              <View style={styles.modalHeader}>
                <View style={styles.modalAvatar}>
                  <Text style={styles.modalAvatarText}>💼</Text>
                </View>
                <Text style={styles.modalTitle}>{selectedAlly?.name}</Text>
              </View>

              {/* 연결자 기본 정보: 통계를 불러오지 못해도 항상 보여준다 */}
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>파트너 정보</Text>
                {[
                  ['회사명', selectedAlly?.business_name],
                  ['주요 지역', selectedAlly?.main_region],
                  ['회당 비용', selectedAlly?.fee_per_session ? `${Number(selectedAlly.fee_per_session).toLocaleString()}원` : null],
                  ['인증', selectedAlly?.verified ? '✓ 인증됨' : '미인증'],
                ].map(([label, value]) => (
                  <View key={label} style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{label}</Text>
                    <Text style={styles.infoValue}>{value || '-'}</Text>
                  </View>
                ))}
                {!!selectedAlly?.service_description && (
                  <Text style={styles.serviceDesc}>{selectedAlly.service_description}</Text>
                )}
              </View>

              {loadingStats ? (
                <ActivityIndicator size="large" color="#5B21FF" style={{ marginVertical: 40 }} />
              ) : !poolStats?.available ? (
                <View style={styles.emptyTab}>
                  <Text style={styles.placeholderText}>{poolStats?.reason || '통계를 불러올 수 없습니다'}</Text>
                </View>
              ) : (
                <>
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>회원 구성</Text>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>성별</Text>
                      <Text style={styles.infoValue}>👨 {poolStats.male_count}명 · 👩 {poolStats.female_count}명</Text>
                    </View>
                  </View>

                  {!poolStats.meets_min_pool ? (
                    <View style={styles.approvedStatus}>
                      <Text style={styles.approvedStatusText}>회원 수 부족 (분포 통계 비공개)</Text>
                    </View>
                  ) : poolStats.scope === 'full' ? (
                    <>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>연령 분포</Text>
                        {Object.entries(poolStats.age_distribution || {}).map(([bucket, pct]: [string, any]) => (
                          <View key={bucket} style={styles.infoRow}>
                            <Text style={styles.infoLabel}>{bucket}</Text>
                            <Text style={styles.infoValue}>{pct}%</Text>
                          </View>
                        ))}
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>지역 분포</Text>
                        {(poolStats.region_distribution || []).map((r: any) => (
                          <View key={r.label} style={styles.infoRow}>
                            <Text style={styles.infoLabel}>{r.label}</Text>
                            <Text style={styles.infoValue}>{r.pct}%</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>요약 (동맹 시 전체 공개)</Text>
                      {poolStats.top_age_bucket && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>주요 연령대</Text>
                          <Text style={styles.infoValue}>{poolStats.top_age_bucket.label} {poolStats.top_age_bucket.pct}%</Text>
                        </View>
                      )}
                      {poolStats.top_region && (
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>주요 지역</Text>
                          <Text style={styles.infoValue}>{poolStats.top_region.label} {poolStats.top_region.pct}%</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <Text style={styles.matchDate}>
                    {new Date(poolStats.computed_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 기준
                  </Text>
                </>
              )}
            </View>
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  emptyTab: {
    paddingHorizontal: 20,
    paddingVertical: 40,
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
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  connTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F1ECFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
  },
  connInfo: {
    flex: 1,
  },
  name: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  desc: {
    fontSize: 11,
    color: '#999',
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  chatBtn: {
    backgroundColor: '#F1ECFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  chatBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5B21FF',
  },
  approveBtn: {
    backgroundColor: '#5B21FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  rejectBtn: {
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  rejectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  approvedStatusBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 30,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1ECFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalAvatarText: {
    fontSize: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  serviceDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
    marginTop: 10,
  },
  modalSection: {
    marginBottom: 30,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  approvedStatus: {
    backgroundColor: '#F1ECFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#5B21FF',
  },
  approvedStatusText: {
    color: '#5B21FF',
    fontSize: 14,
    fontWeight: '700',
  },
  matchDate: {
    fontSize: 11,
    color: '#999',
  },
});
