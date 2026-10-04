import { supabase } from './supabase';

export type Refundable = { wallet: number; credit: number; sessions: number; total: number };

// 지금 환불받을 수 있는 금액 (지갑 잔액 + 진행 중 매칭에 묶이지 않은 이용권)
export async function getRefundable(hopefulId: string): Promise<Refundable> {
  const { data, error } = await supabase.rpc('fn_get_refundable', { p_hopeful_id: hopefulId });
  if (error || !data) return { wallet: 0, credit: 0, sessions: 0, total: 0 };
  return {
    wallet: Number(data.wallet) || 0,
    credit: Number(data.credit) || 0,
    sessions: Number(data.sessions) || 0,
    total: Number(data.total) || 0,
  };
}

export async function getPendingRefund(hopefulId: string) {
  const { data } = await supabase
    .from('refund_requests')
    .select('*')
    .eq('hopeful_id', hopefulId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function requestRefund(params: { hopefulId: string; bankName: string; accountNumber: string; accountHolder: string }) {
  return supabase.from('refund_requests').insert([{
    hopeful_id: params.hopefulId,
    bank_name: params.bankName.trim(),
    account_number: params.accountNumber.trim(),
    account_holder: params.accountHolder.trim(),
  }]);
}

export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: 'in_progress' | 'refund_needed' | 'payout_left' | 'error'; amount?: number };

export async function withdrawAccount(userId: string): Promise<WithdrawResult> {
  const { data, error } = await supabase.rpc('fn_withdraw_user', { p_user_id: userId });
  if (error || !data) return { ok: false, reason: 'error' };
  return data as WithdrawResult;
}
