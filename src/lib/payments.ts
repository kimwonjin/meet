import { supabase } from './supabase';
import { createNotification } from './notifications';

export const PACKAGE_OPTIONS = [1, 3, 5, 10];
export const CHARGE_OPTIONS = [10000, 30000, 50000, 100000];

// ponytail: 포트원 연동 전까지는 클라이언트에서 mock 승인 처리.
// 실제 카드결제 연동 시 서버(Edge Function)에서 PG 응답을 검증한 뒤 insert하도록 교체할 것.
export async function chargeWallet(hopefulId: string, amount: number) {
  const { data, error } = await supabase
    .from('wallet_charges')
    .insert({
      hopeful_id: hopefulId,
      amount,
      status: 'paid',
      pg_provider: 'mock',
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  return { data, error };
}

export async function getWalletBalance(hopefulId: string) {
  const { data, error } = await supabase.rpc('fn_get_wallet_balance', { p_hopeful_id: hopefulId });
  if (error) return { balance: 0, error };
  return { balance: Number(data) || 0, error: null };
}

// 연결자별 이용권(디파짓) 구매 - 지갑 잔액에서 차감한다.
export async function purchasePackage(hopefulId: string, connectorId: string, sessionCount: number) {
  const { data: connector, error: connErr } = await supabase
    .from('connectors')
    .select('fee_per_session')
    .eq('id', connectorId)
    .single();

  if (connErr || !connector?.fee_per_session) {
    return { data: null, error: connErr || new Error('연결자 요금 정보를 찾을 수 없습니다') };
  }

  const amountTotal = connector.fee_per_session * sessionCount;

  const { balance, error: balErr } = await getWalletBalance(hopefulId);
  if (balErr) return { data: null, error: balErr };
  if (balance < amountTotal) {
    return { data: null, error: new Error('지갑 잔액이 부족합니다. 먼저 충전해주세요.') };
  }

  const { data, error } = await supabase
    .from('payments')
    .insert({
      hopeful_id: hopefulId,
      connector_id: connectorId,
      session_count: sessionCount,
      amount_total: amountTotal,
      amount_per_session: connector.fee_per_session,
      sessions_remaining: sessionCount,
      status: 'paid',
      pg_provider: 'mock',
      paid_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (!error) {
    await createNotification({
      userId: hopefulId,
      type: 'payment_completed',
      title: '결제가 완료되었습니다',
      body: `이용권 ${sessionCount}회 결제가 완료되었습니다`,
      route: '/profile',
    });
  }

  return { data, error };
}

export async function getCredit(hopefulId: string, connectorId: string) {
  const { data, error } = await supabase
    .from('payments')
    .select('sessions_remaining')
    .eq('hopeful_id', hopefulId)
    .eq('connector_id', connectorId)
    .eq('status', 'paid');

  if (error) return { credit: 0, error };
  const credit = (data || []).reduce((sum: number, p: any) => sum + p.sessions_remaining, 0);
  return { credit, error: null };
}

// 희망자가 결제한 이력이 있는 연결자별로 이용가능/사용 수량을 묶어서 보여준다 (프로필 > 이용권/결제 화면용)
export async function getMyConnectorCredits(hopefulId: string) {
  const { data: payments, error } = await supabase
    .from('payments')
    .select('*')
    .eq('hopeful_id', hopefulId)
    .eq('status', 'paid');

  if (error) return { data: [], error };
  if (!payments || payments.length === 0) return { data: [], error: null };

  const connectorIds = [...new Set(payments.map((p: any) => p.connector_id))];

  const [{ data: connectorRows }, { data: connectorUsers }] = await Promise.all([
    supabase.from('connectors').select('id, fee_per_session').in('id', connectorIds),
    supabase.from('users').select('id, name').in('id', connectorIds),
  ]);

  const result = connectorIds.map((id) => {
    const myPayments = payments.filter((p: any) => p.connector_id === id);
    const purchased = myPayments.reduce((sum: number, p: any) => sum + p.session_count, 0);
    const available = myPayments.reduce((sum: number, p: any) => sum + p.sessions_remaining, 0);
    const refunded = myPayments.reduce((sum: number, p: any) => sum + (p.refunded_sessions || 0), 0);
    const used = purchased - available - refunded;
    const totalCharged = myPayments.reduce((sum: number, p: any) => sum + Number(p.amount_total), 0);
    return {
      connectorId: id,
      connectorName: (connectorUsers || []).find((u: any) => u.id === id)?.name || '연결자',
      feePerSession: (connectorRows || []).find((c: any) => c.id === id)?.fee_per_session || 0,
      totalCharged,
      purchased,
      available,
      used,
      refunded,
    };
  });

  return { data: result, error: null };
}
