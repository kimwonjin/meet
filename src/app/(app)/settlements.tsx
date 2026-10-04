import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { createNotification } from '@/lib/notifications';
import { useConfirm } from '@/contexts/ConfirmContext';
import NotificationBell from '@/components/NotificationBell';
import { getRefundable } from '@/lib/refunds';

type Segment = 'settlements' | 'approvals' | 'withdrawals' | 'refunds';

export default function SettlementsScreen() {
  const toast = useToast();
  const confirm = useConfirm();
  const [settlements, setSettlements] = useState<any[]>([]);
  const [pendingConnectors, setPendingConnectors] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<Segment>('settlements');
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [])
  );

  async function fetchAll() {
    await Promise.all([fetchSettlements(), fetchPendingConnectors(), fetchWithdrawals(), fetchRefunds()]);
    setLoading(false);
  }

  async function fetchSettlements() {
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const userIds = (data || []).flatMap((s: any) => [s.hopeful_id, s.connector_id]);
      const { data: users } = await supabase.from('users').select('id, name').in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

      const enriched = (data || []).map((s: any) => ({
        ...s,
        hopeful_name: (users || []).find((u: any) => u.id === s.hopeful_id)?.name || '희망자',
        connector_name: (users || []).find((u: any) => u.id === s.connector_id)?.name || '연결자',
      }));

      setSettlements(enriched);
    } catch (error) {
      console.error('Error fetching settlements:', error);
    }
  }

  async function fetchPendingConnectors() {
    try {
      const { data, error } = await supabase
        .from('connectors')
        .select('*')
        .eq('status', 'pending');
      if (error) throw error;

      const ids = (data || []).map((c: any) => c.id);
      const { data: users } = await supabase.from('users').select('id, name, phone').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

      const enriched = (data || []).map((c: any) => ({
        ...c,
        name: (users || []).find((u: any) => u.id === c.id)?.name || '신청자',
        phone: (users || []).find((u: any) => u.id === c.id)?.phone || '-',
      }));
      setPendingConnectors(enriched);
    } catch (error) {
      console.error('Error fetching pending connectors:', error);
    }
  }

  async function fetchWithdrawals() {
    try {
      const { data, error } = await supabase
        .from('withdrawal_requests')
        .select('*')
        .order('requested_at', { ascending: false });
      if (error) throw error;

      const ids = (data || []).map((w: any) => w.connector_id);
      const { data: users } = await supabase.from('users').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

      const enriched = (data || []).map((w: any) => ({
        ...w,
        connector_name: (users || []).find((u: any) => u.id === w.connector_id)?.name || '연결자',
      }));
      setWithdrawals(enriched);
    } catch (error) {
      console.error('Error fetching withdrawals:', error);
    }
  }

  async function fetchRefunds() {
    try {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('*')
        .order('requested_at', { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data || []).map((r: any) => r.hopeful_id))];
      const { data: users } = await supabase.from('users').select('id, name').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      // 대기 중인 요청은 지금 시점 환불 가능 금액을 함께 보여준다
      const enriched = await Promise.all((data || []).map(async (r: any) => ({
        ...r,
        hopeful_name: (users || []).find((u: any) => u.id === r.hopeful_id)?.name || '회원',
        current: r.status === 'pending' ? await getRefundable(r.hopeful_id) : null,
      })));
      setRefunds(enriched);
    } catch (error) {
      console.error('Error fetching refunds:', error);
    }
  }

  async function handleCompleteRefund(requestId: string) {
    setProcessingId(requestId);
    try {
      const { data, error } = await supabase.rpc('fn_process_refund', { p_request_id: requestId });
      if (error) throw error;
      toast.show(`✓ ${Number(data?.total ?? 0).toLocaleString()}원 환불을 완료 처리했습니다`, 'success');
      await fetchRefunds();
    } catch (error) {
      console.error(error);
      toast.show('환불 처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRejectRefund(item: any) {
    setProcessingId(item.id);
    try {
      const { error } = await supabase
        .from('refund_requests')
        .update({ status: 'rejected', processed_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      await createNotification({
        userId: item.hopeful_id,
        type: 'refund_rejected',
        title: '환불 요청이 반려되었습니다',
        body: '자세한 내용은 운영자 채팅으로 문의해주세요',
        route: '/chat',
      });
      toast.show('환불 요청을 반려했습니다', 'info');
      await fetchRefunds();
    } catch (error) {
      console.error(error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleApproveConnector(connectorId: string) {
    setProcessingId(connectorId);
    try {
      const { error: e1 } = await supabase.from('connectors').update({ status: 'approved' }).eq('id', connectorId);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('users').update({ role: 'connector' }).eq('id', connectorId);
      if (e2) throw e2;

      await createNotification({
        userId: connectorId,
        type: 'connector_approved',
        title: '매칭 파트너로 승인되었습니다',
        body: '이제 회원을 받고 매칭을 제안할 수 있어요',
        route: '/home',
      });
      toast.show('✓ 매칭 파트너를 승인했습니다', 'success');
      await fetchPendingConnectors();
    } catch (error) {
      console.error(error);
      toast.show('승인 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRejectConnector(connectorId: string) {
    setProcessingId(connectorId);
    try {
      const { error } = await supabase.from('connectors').update({ status: 'rejected' }).eq('id', connectorId);
      if (error) throw error;

      await createNotification({
        userId: connectorId,
        type: 'connector_rejected',
        title: '매칭 파트너 신청이 반려되었습니다',
        body: '프로필 › 매칭 파트너에서 다시 신청할 수 있어요',
        route: '/profile',
      });
      toast.show('매칭 파트너 신청을 반려했습니다', 'info');
      await fetchPendingConnectors();
    } catch (error) {
      console.error(error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleCompleteWithdrawal(withdrawalId: string) {
    setProcessingId(withdrawalId);
    try {
      const { error } = await supabase
        .from('withdrawal_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', withdrawalId);
      if (error) throw error;

      toast.show('✓ 출금 처리를 완료했습니다', 'success');
      await fetchWithdrawals();
    } catch (error) {
      console.error(error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  const totalPayout = settlements.reduce((sum, s) => sum + Number(s.connector_payout), 0);
  const totalFee = settlements.reduce((sum, s) => sum + Number(s.platform_fee), 0);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const completedWithdrawals = withdrawals.filter((w) => w.status === 'completed');
  const pendingRefunds = refunds.filter((r) => r.status === 'pending');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>정산 관리</Text>
          <NotificationBell />
        </View>
      </View>

      <View style={styles.segmentRow}>
        {([
          { key: 'settlements', label: '정산' },
          { key: 'approvals', label: `파트너 승인${pendingConnectors.length > 0 ? ` (${pendingConnectors.length})` : ''}` },
          { key: 'withdrawals', label: `출금${pendingWithdrawals.length > 0 ? ` (${pendingWithdrawals.length})` : ''}` },
          { key: 'refunds', label: `환불${pendingRefunds.length > 0 ? ` (${pendingRefunds.length})` : ''}` },
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

      {segment === 'settlements' && (
        settlements.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>정산 내역이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={settlements}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>총 연결자 지급액</Text>
                  <Text style={styles.summaryValue}>{totalPayout.toLocaleString()}원</Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>총 플랫폼 수수료</Text>
                  <Text style={styles.summaryValue}>{totalFee.toLocaleString()}원</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.connector_name} ← {item.hopeful_name}</Text>
                  <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString('ko-KR')}</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.rowLabel}>회당 금액</Text>
                  <Text style={styles.rowValue}>{Number(item.amount_per_session).toLocaleString()}원</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>플랫폼 수수료 (20%)</Text>
                  <Text style={styles.rowValue}>{Number(item.platform_fee).toLocaleString()}원</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>연결자 지급액 (80%)</Text>
                  <Text style={styles.payoutValue}>{Number(item.connector_payout).toLocaleString()}원</Text>
                </View>

                <View style={styles.paidBadge}>
                  <Text style={styles.paidBadgeText}>
                    ✓ {item.settled_at ? new Date(item.settled_at).toLocaleDateString('ko-KR') : ''} 정산 완료
                  </Text>
                </View>
              </View>
            )}
          />
        )
      )}

      {segment === 'approvals' && (
        pendingConnectors.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>심사 대기 중인 신청이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={pendingConnectors}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardDate}>{item.phone}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>회사명</Text>
                  <Text style={styles.rowValue}>{item.business_name}</Text>
                </View>
                <View style={styles.approvalBtnRow}>
                  <TouchableOpacity
                    style={[styles.approveBtn, processingId === item.id && styles.buttonDisabled]}
                    onPress={() => handleApproveConnector(item.id)}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.approveBtnText}>{processingId === item.id ? '처리 중...' : '승인'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rejectBtn, processingId === item.id && styles.buttonDisabled]}
                    onPress={async () => {
                      if (await confirm({ title: '파트너 신청을 반려할까요?', confirmText: '반려', destructive: true })) handleRejectConnector(item.id);
                    }}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.rejectBtnText}>반려</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      )}

      {segment === 'withdrawals' && (
        withdrawals.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>출금 신청 내역이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={[...pendingWithdrawals, ...completedWithdrawals]}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.connector_name}</Text>
                  <Text style={styles.cardDate}>{new Date(item.requested_at).toLocaleDateString('ko-KR')}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>신청 금액</Text>
                  <Text style={styles.payoutValue}>{Number(item.amount).toLocaleString()}원</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>입금 계좌</Text>
                  <Text style={styles.rowValue}>{item.bank_name} {item.account_number} ({item.account_holder})</Text>
                </View>
                {item.status === 'completed' ? (
                  <View style={styles.paidBadge}>
                    <Text style={styles.paidBadgeText}>
                      ✓ {item.completed_at ? new Date(item.completed_at).toLocaleDateString('ko-KR') : ''} 지급 완료
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.approveBtn, { marginTop: 10 }, processingId === item.id && styles.buttonDisabled]}
                    onPress={async () => {
                      if (await confirm({ title: '지급 완료로 처리할까요?', message: '실제로 입금을 마친 뒤에 처리해주세요. 처리 후에는 되돌릴 수 없습니다.', confirmText: '지급 완료' })) handleCompleteWithdrawal(item.id);
                    }}
                    disabled={processingId !== null}
                  >
                    <Text style={styles.approveBtnText}>{processingId === item.id ? '처리 중...' : '지급 완료 처리'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        )
      )}

      {segment === 'refunds' && (
        refunds.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>환불 요청 내역이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={[...pendingRefunds, ...refunds.filter((r) => r.status !== 'pending')]}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.hopeful_name}</Text>
                  <Text style={styles.cardDate}>{new Date(item.requested_at).toLocaleDateString('ko-KR')}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{item.status === 'pending' ? '지금 환불할 금액' : '환불 금액'}</Text>
                  <Text style={styles.payoutValue}>
                    {(item.status === 'pending' ? item.current?.total ?? 0 : Number(item.wallet_amount) + Number(item.credit_amount)).toLocaleString()}원
                  </Text>
                </View>
                {item.status === 'pending' && item.current && (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>내역</Text>
                    <Text style={styles.rowValue}>
                      충전 잔액 {item.current.wallet.toLocaleString()}원 · 이용권 {item.current.sessions}회 {item.current.credit.toLocaleString()}원
                    </Text>
                  </View>
                )}
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>입금 계좌</Text>
                  <Text style={styles.rowValue}>{item.bank_name} {item.account_number} ({item.account_holder})</Text>
                </View>
                {item.status === 'completed' ? (
                  <View style={styles.paidBadge}>
                    <Text style={styles.paidBadgeText}>✓ {new Date(item.processed_at).toLocaleDateString('ko-KR')} 환불 완료</Text>
                  </View>
                ) : item.status === 'rejected' ? (
                  <Text style={[styles.rowLabel, { marginTop: 10 }]}>반려됨</Text>
                ) : (
                  <View style={styles.approvalBtnRow}>
                    <TouchableOpacity
                      style={[styles.approveBtn, processingId === item.id && styles.buttonDisabled]}
                      onPress={async () => {
                        if (await confirm({
                          title: '환불 완료로 처리할까요?',
                          message: `${(item.current?.total ?? 0).toLocaleString()}원을 입금한 뒤에 처리해주세요. 남은 이용권이 차감되고 되돌릴 수 없습니다.`,
                          confirmText: '환불 완료',
                        })) handleCompleteRefund(item.id);
                      }}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.approveBtnText}>{processingId === item.id ? '처리 중...' : '환불 완료 처리'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rejectBtn, processingId === item.id && styles.buttonDisabled]}
                      onPress={async () => {
                        if (await confirm({ title: '환불 요청을 반려할까요?', message: '회원에게 반려 알림이 갑니다.', confirmText: '반려', destructive: true })) handleRejectRefund(item);
                      }}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.rejectBtnText}>반려</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          />
        )
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
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  segmentBtnTextActive: {
    color: '#5B21FF',
  },
  placeholder: {
    flex: 1,
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
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: '#F1ECFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#5B21FF',
  },
  card: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 11,
    color: '#999',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 12,
    color: '#666',
  },
  rowValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  payoutValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#5B21FF',
  },
  paidBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  paidBadgeText: {
    color: '#2E7D32',
    fontWeight: '500',
    fontSize: 12,
  },
  approvalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#5B21FF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rejectBtnText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
