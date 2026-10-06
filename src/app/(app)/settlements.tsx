import React, { useState, useEffect, useCallback } from 'react';
import BottomSheet from '@/components/BottomSheet';
import SkeletonScreen from '@/components/Skeleton';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { createNotification } from '@/lib/notifications';
import { useConfirm } from '@/contexts/ConfirmContext';
import NotificationBell from '@/components/NotificationBell';
import { getRefundable } from '@/lib/refunds';

type Segment = 'settlements' | 'approvals' | 'withdrawals' | 'refunds' | 'reports';

export default function SettlementsScreen() {
  const toast = useToast();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [settlements, setSettlements] = useState<any[]>([]);
  const [pendingConnectors, setPendingConnectors] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string; reason: string } | null>(null);
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
  const pullRefresh = usePullRefresh(() => fetchAll());

  async function fetchAll() {
    await Promise.all([fetchSettlements(), fetchPendingConnectors(), fetchWithdrawals(), fetchRefunds(), fetchReports()]);
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
        hopeful_name: (users || []).find((u: any) => u.id === s.hopeful_id)?.name || '회원',
        connector_name: (users || []).find((u: any) => u.id === s.connector_id)?.name || '파트너',
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

      // 대기 중인 출금은 파트너의 남은 정산금을 함께 보여준다 (출금 신청 합계가 번 금액을 넘지 않는지 확인용)
      const pendingIds = [...new Set((data || []).filter((w: any) => w.status === 'pending').map((w: any) => w.connector_id))];
      const balances: Record<string, number> = {};
      await Promise.all(pendingIds.map(async (id: any) => {
        const { data: left } = await supabase.rpc('fn_connector_available_payout', { p_connector_id: id });
        balances[id] = Number(left) || 0;
      }));
      const enriched = (data || []).map((w: any) => ({
        ...w,
        connector_name: (users || []).find((u: any) => u.id === w.connector_id)?.name || '파트너',
        remaining_after: balances[w.connector_id],
      }));
      setWithdrawals(enriched);
    } catch (error) {
      console.error('Error fetching withdrawals:', error);
    }
  }

  async function fetchReports() {
    try {
      const { data, error } = await supabase.from('user_reports').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data || []).flatMap((r: any) => [r.reporter_id, r.target_id]))];
      const { data: users } = await supabase.from('users').select('id, name, role, suspended_at').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const nameOf = (id: string) => {
        const u = (users || []).find((x: any) => x.id === id);
        return u ? `${u.name}${u.role === 'connector' ? ' (파트너)' : ''}` : '알 수 없음';
      };
      setReports((data || []).map((r: any) => ({
        ...r,
        reporter_name: nameOf(r.reporter_id),
        target_name: nameOf(r.target_id),
        target_suspended: !!(users || []).find((x: any) => x.id === r.target_id)?.suspended_at,
        // 같은 사람에 대한 신고 수 (반복 신고 판단용)
        target_report_count: (data || []).filter((x: any) => x.target_id === r.target_id).length,
      })));
    } catch (error) {
      console.error('Error fetching reports:', error);
    }
  }

  async function handleResolveReport(id: string) {
    setProcessingId(id);
    try {
      const { error } = await supabase.from('user_reports').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id).eq('status', 'open');
      if (error) throw error;
      toast.show('✓ 확인 완료로 처리했습니다', 'success');
      await fetchReports();
    } catch (error) {
      console.error('Error resolving report:', error);
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSuspend(targetId: string, reason: string) {
    setProcessingId(targetId);
    try {
      const { error } = await supabase.from('users').update({ suspended_at: new Date().toISOString(), suspended_reason: reason }).eq('id', targetId);
      if (error) throw error;
      toast.show('✓ 이용을 정지했습니다. 이 사람은 로그인할 수 없고 새 매칭에서 빠져요', 'success');
      setSuspendTarget(null);
      await fetchReports();
    } catch (error) {
      console.error('Error suspending user:', error);
      toast.show('정지 처리 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleUnsuspend(targetId: string) {
    setProcessingId(targetId);
    try {
      const { error } = await supabase.from('users').update({ suspended_at: null, suspended_reason: null }).eq('id', targetId);
      if (error) throw error;
      toast.show('정지를 해제했습니다', 'success');
      await fetchReports();
    } catch (error) {
      console.error('Error unsuspending user:', error);
      toast.show('해제 중 오류가 발생했습니다', 'error');
    } finally {
      setProcessingId(null);
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

  async function handleCompleteRefund(requestId: string, expectedTotal: number) {
    setProcessingId(requestId);
    try {
      // 화면에서 확인한 금액과 처리 시점 금액이 다르면 처리하지 않는다 (그 사이 충전·정산이 있었던 경우)
      const { data, error } = await supabase.rpc('fn_process_refund', { p_request_id: requestId, p_expected_total: expectedTotal });
      if (error || !data) throw error;
      if (!data.ok) {
        toast.show(
          data.reason === 'amount_changed'
            ? `환불 금액이 ${Number(data.total).toLocaleString()}원으로 바뀌었어요. 금액을 다시 확인한 뒤 처리해주세요`
            : '이미 처리된 요청이에요',
          'error'
        );
        await fetchRefunds();
        return;
      }
      toast.show(`✓ ${Number(data.total ?? 0).toLocaleString()}원 환불을 완료 처리했습니다`, 'success');
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
      const { data: rejected, error } = await supabase
        .from('refund_requests')
        .update({ status: 'rejected', processed_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');
      if (error) throw error;
      if (!rejected?.length) {
        toast.show('이미 처리된 요청이에요', 'info');
        await fetchRefunds();
        return;
      }
      await createNotification({
        userId: item.hopeful_id,
        type: 'refund_rejected',
        title: '환불 요청이 반려되었습니다',
        body: '자세한 내용은 운영자 채팅으로 문의해주세요',
        route: '/chat',
        routeParams: user ? { with: user.id, name: user.name } : undefined,
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
        body: '마이 › 매칭 파트너에서 다시 신청할 수 있어요',
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
      const { data: done, error } = await supabase
        .from('withdrawal_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', withdrawalId)
        .eq('status', 'pending')
        .select('id');
      if (error) throw error;
      if (!done?.length) {
        toast.show('이미 지급 완료된 요청이에요', 'info');
        await fetchWithdrawals();
        return;
      }

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
    return <SkeletonScreen />;
  }

  const totalPayout = settlements.reduce((sum, s) => sum + Number(s.connector_payout), 0);
  const totalFee = settlements.reduce((sum, s) => sum + Number(s.platform_fee), 0);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const completedWithdrawals = withdrawals.filter((w) => w.status === 'completed');
  const pendingRefunds = refunds.filter((r) => r.status === 'pending');
  const openReports = reports.filter((r) => r.status === 'open');

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
          { key: 'reports', label: `신고${openReports.length > 0 ? ` (${openReports.length})` : ''}` },
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
            refreshControl={pullRefresh}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryLabel}>파트너 정산 합계</Text>
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
                  <Text style={styles.rowLabel}>파트너 몫 (80%)</Text>
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
            refreshControl={pullRefresh}
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
            refreshControl={pullRefresh}
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
                {item.status === 'pending' && item.remaining_after !== undefined && (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>신청 후 남은 정산금</Text>
                    <Text style={[styles.rowValue, item.remaining_after < 0 && { color: '#E53935' }]}>
                      {item.remaining_after.toLocaleString()}원{item.remaining_after < 0 ? ' (초과 신청 · 지급 전 확인 필요)' : ''}
                    </Text>
                  </View>
                )}
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
            refreshControl={pullRefresh}
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
                        })) handleCompleteRefund(item.id, item.current?.total ?? 0);
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
      {segment === 'reports' && (
        reports.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>신고 내역이 없습니다</Text>
          </View>
        ) : (
          <FlatList
            data={[...openReports, ...reports.filter((r) => r.status !== 'open')]}
            keyExtractor={(item) => item.id}
            refreshControl={pullRefresh}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.reason}</Text>
                  <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString('ko-KR')}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>신고 대상</Text>
                  <Text style={styles.rowValue}>{item.target_name}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>신고한 사람</Text>
                  <Text style={styles.rowValue}>{item.reporter_name}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>신고한 곳</Text>
                  <Text style={styles.rowValue}>{({ match: '소개팅 상대', chat: '채팅', partner: '파트너 정보' } as Record<string, string>)[item.context] ?? item.context}</Text>
                </View>
                {!!item.detail && <Text style={styles.reportDetail}>{item.detail}</Text>}
                {item.target_report_count > 1 && (
                  <Text style={styles.reportRepeat}>이 사람에 대한 신고 {item.target_report_count}건</Text>
                )}
                <View style={styles.suspendRow}>
                  {item.target_suspended ? (
                    <>
                      <Text style={styles.suspendedText}>⛔ 이용 정지 중</Text>
                      <TouchableOpacity onPress={() => handleUnsuspend(item.target_id)} disabled={processingId !== null}>
                        <Text style={styles.unsuspendText}>{processingId === item.target_id ? '처리 중...' : '정지 해제'}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.suspendBtn}
                      onPress={() => setSuspendTarget({ id: item.target_id, name: item.target_name, reason: item.reason })}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.suspendBtnText}>{item.target_name} 이용 정지</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {item.status === 'resolved' ? (
                  <View style={styles.paidBadge}>
                    <Text style={styles.paidBadgeText}>✓ {new Date(item.resolved_at).toLocaleDateString('ko-KR')} 확인 완료</Text>
                  </View>
                ) : (
                  <View style={styles.approvalBtnRow}>
                    <TouchableOpacity
                      style={[styles.approveBtn, processingId === item.id && styles.buttonDisabled]}
                      onPress={() => handleResolveReport(item.id)}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.approveBtnText}>{processingId === item.id ? '처리 중...' : '확인 완료'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          />
        )
      )}

      <BottomSheet visible={suspendTarget !== null} onClose={() => setSuspendTarget(null)} title={`${suspendTarget?.name ?? ''} 이용 정지`}>
        <Text style={styles.sheetText}>정지하면 이 사람은 로그인할 수 없고, 파트너 목록과 새 매칭 후보에서 빠집니다.</Text>
        <Text style={styles.sheetSub}>이미 진행 중인 매칭은 그대로 남으니 필요하면 해당 파트너와 상의해 정리해주세요. 정지는 이 화면에서 언제든 해제할 수 있어요.</Text>
        <Text style={styles.sheetSub}>정지 사유: {suspendTarget?.reason}</Text>
        <TouchableOpacity
          style={[styles.suspendConfirm, processingId !== null && styles.buttonDisabled]}
          onPress={() => suspendTarget && handleSuspend(suspendTarget.id, suspendTarget.reason)}
          disabled={processingId !== null}
        >
          {processingId ? <ActivityIndicator color="#fff" /> : <Text style={styles.suspendConfirmText}>이용 정지</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  reportRepeat: { fontSize: 12, color: '#E53935', fontWeight: '600', marginTop: 8 },
  suspendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  suspendedText: { fontSize: 13, color: '#E53935', fontWeight: '700' },
  unsuspendText: { fontSize: 13, color: '#666', textDecorationLine: 'underline', paddingVertical: 6 },
  suspendBtn: { borderWidth: 1, borderColor: '#E53935', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: 'flex-start' },
  suspendBtnText: { color: '#E53935', fontSize: 13, fontWeight: '600' },
  sheetText: { fontSize: 14, color: '#333', lineHeight: 21, marginBottom: 8 },
  sheetSub: { fontSize: 13, color: '#888', lineHeight: 19, marginBottom: 8 },
  suspendConfirm: { backgroundColor: '#E53935', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  suspendConfirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  reportDetail: { fontSize: 13, color: '#444', backgroundColor: '#F7F7F9', borderRadius: 8, padding: 10, marginTop: 8, lineHeight: 19 },
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
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  paidBadgeText: {
    color: '#5B21FF',
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
