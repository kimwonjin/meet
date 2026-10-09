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

export type PurchaseResult =
  | { ok: true; total: number }
  | { ok: false; reason: 'invalid' | 'not_member' | 'no_fee' | 'fee_changed' | 'insufficient' | 'error'; fee?: number; balance?: number; total?: number };

// 파트너 이용권 구매 - 지갑 잔액에서 차감한다.
// 잔액·요금 확인과 결제 기록은 서버 함수 안에서 한 번에 처리한다 (빠른 두 번 클릭·두 기기 동시 결제 방지).
// expectedFee: 화면에 보여준 1회 요금. 그 사이 요금이 바뀌었으면 결제하지 않는다.
export async function purchasePackage(hopefulId: string, connectorId: string, sessionCount: number, expectedFee: number): Promise<PurchaseResult> {
  const { data, error } = await supabase.rpc('fn_purchase_package', {
    p_hopeful_id: hopefulId,
    p_connector_id: connectorId,
    p_session_count: sessionCount,
    p_expected_fee: expectedFee,
  });
  if (error || !data) return { ok: false, reason: 'error' };
  const result = data as PurchaseResult;
  if (result.ok) {
    await createNotification({
      userId: hopefulId,
      type: 'payment_completed',
      title: '결제가 완료되었습니다',
      body: `이용권 ${sessionCount}회 결제가 완료되었습니다`,
      route: '/profile',
    });
  }
  return result;
}

// 새 매칭에 쓸 수 있는 이용권 수 (진행 중인 매칭에 묶인 이용권은 뺀다)
// 파트너가 회원에게 선물한 무료 이용권 (결제 기록의 pg_provider로 구분)
export const FREE_GIFT = 'free_gift';

// 이 파트너에게 쓸 수 있는 무료 이용권 남은 횟수
export async function getFreeCredit(hopefulId: string, connectorId: string) {
  const { data } = await supabase
    .from('payments')
    .select('sessions_remaining')
    .eq('hopeful_id', hopefulId)
    .eq('connector_id', connectorId)
    .eq('pg_provider', FREE_GIFT)
    .eq('status', 'paid');
  return (data || []).reduce((s: number, p: any) => s + (p.sessions_remaining || 0), 0);
}

// 파트너: 이미 무료 이용권을 준 회원 목록. 서버 준비 전(SQL 실행 전)이면 null → 기능을 숨긴다
export async function fetchFreeGiven(connectorId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase.rpc('fn_free_credit_given', { p_connector_id: connectorId });
  if (error) return null;
  return new Set(Array.isArray(data) ? data : []);
}

export async function grantFreeCredit(connectorId: string, hopefulId: string): Promise<'ok' | 'already' | 'not_member' | 'inactive' | 'error'> {
  const { data, error } = await supabase.rpc('fn_grant_free_credit', { p_connector_id: connectorId, p_hopeful_id: hopefulId });
  if (error || !data) return 'error';
  return data.ok ? 'ok' : (data.reason as any) || 'error';
}

export async function getCredit(hopefulId: string, connectorId: string) {
  const { data, error } = await supabase.rpc('fn_available_credit', { p_hopeful_id: hopefulId, p_connector_id: connectorId });
  if (error) return { credit: 0, error };
  return { credit: Number(data) || 0, error: null };
}

// 회원이 결제한 이력이 있는 파트너별로 이용가능/사용 수량을 묶어서 보여준다 (마이 > 이용권/결제 화면용)
export async function getMyConnectorCredits(hopefulId: string) {
  const { data: payments, error } = await supabase
    .from('payments')
    .select('*')
    .eq('hopeful_id', hopefulId)
    .eq('status', 'paid');

  if (error) return { data: [], error };
  if (!payments || payments.length === 0) return { data: [], error: null };

  const connectorIds = [...new Set(payments.map((p: any) => p.connector_id))];

  const { data: connectorRows } = await supabase.from('connectors').select('id, fee_per_session, business_name').in('id', connectorIds);

  const result = connectorIds.map((id) => {
    const myPayments = payments.filter((p: any) => p.connector_id === id);
    // 파트너가 선물한 무료 이용권은 '구매'에서 빼고 따로 센다
    const gifts = myPayments.filter((p: any) => p.pg_provider === FREE_GIFT);
    const purchased = myPayments.filter((p: any) => p.pg_provider !== FREE_GIFT).reduce((sum: number, p: any) => sum + p.session_count, 0);
    const freeReceived = gifts.reduce((sum: number, p: any) => sum + p.session_count, 0);
    const freeAvailable = gifts.reduce((sum: number, p: any) => sum + p.sessions_remaining, 0);
    const available = myPayments.reduce((sum: number, p: any) => sum + p.sessions_remaining, 0);
    const refunded = myPayments.reduce((sum: number, p: any) => sum + (p.refunded_sessions || 0), 0);
    const used = purchased + freeReceived - available - refunded;
    const totalCharged = myPayments.reduce((sum: number, p: any) => sum + Number(p.amount_total), 0);
    return {
      connectorId: id,
      connectorName: (connectorRows || []).find((c: any) => c.id === id)?.business_name || '파트너',
      feePerSession: (connectorRows || []).find((c: any) => c.id === id)?.fee_per_session || 0,
      totalCharged,
      purchased,
      available,
      used,
      refunded,
      freeReceived,
      freeAvailable,
    };
  });

  return { data: result, error: null };
}
