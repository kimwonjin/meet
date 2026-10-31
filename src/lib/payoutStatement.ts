// 파트너 월별 정산 내역서 (CSV): 그 달 생긴 위탁 수수료(건별)와 그 달 지급한 출금(원천징수·실지급)
// 종합소득세 신고 참고용. 회원 이름은 첫 글자만 (예: 김○○)
import { supabase } from './supabase';
import { withholding } from './tax';
import { BUSINESS } from './business';

const mask = (name?: string | null) => (name ? `${name.slice(0, 1)}○○` : '회원');
const inMonth = (iso: string | null | undefined, y: number, m: number) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === y && d.getMonth() + 1 === m;
};
const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function buildStatement(partner: { id: string; name: string }, y: number, m: number) {
  const [{ data: sets }, { data: wds }] = await Promise.all([
    supabase.from('settlements').select('match_request_id, amount_per_session, platform_fee, connector_payout, created_at').eq('connector_id', partner.id),
    supabase.from('withdrawal_requests').select('amount, status, requested_at, completed_at').eq('connector_id', partner.id),
  ]);
  const earned = ((sets || []) as any[]).filter((s) => inMonth(s.created_at, y, m)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const paid = ((wds || []) as any[]).filter((w) => w.status === 'completed' && inMonth(w.completed_at, y, m)).sort((a, b) => a.completed_at.localeCompare(b.completed_at));

  // 매칭의 두 회원 (이름 첫 글자)
  const mids = [...new Set(earned.map((s) => s.match_request_id).filter(Boolean))];
  const pairs = new Map<string, string>();
  if (mids.length) {
    const { data: ms } = await supabase.from('match_requests').select('id, hopeful_1_id, hopeful_2_id').in('id', mids);
    const uids = [...new Set(((ms || []) as any[]).flatMap((x) => [x.hopeful_1_id, x.hopeful_2_id]))];
    const { data: us } = uids.length ? await supabase.from('users').select('id, name').in('id', uids) : { data: [] as any[] };
    const nm = new Map(((us || []) as any[]).map((u) => [u.id, u.name]));
    for (const x of (ms || []) as any[]) pairs.set(x.id, `${mask(nm.get(x.hopeful_1_id))} · ${mask(nm.get(x.hopeful_2_id))}`);
  }

  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows: (string | number)[][] = [];
  rows.push([`${y}년 ${m}월 정산 내역서`]);
  rows.push([`파트너: ${partner.name}`, `회사: ${BUSINESS.companyName || ''}`, BUSINESS.reportNumber ? `국내결혼중개업 신고 ${BUSINESS.reportNumber}` : '']);
  rows.push([]);
  rows.push(['[1] 이 달 생긴 위탁 수수료 (매칭 마무리 기준)']);
  rows.push(['날짜', '매칭', '1회 금액', '회사 몫', '위탁 수수료']);
  let sumFee = 0;
  for (const s of earned) {
    const fee = Number(s.connector_payout) || 0; sumFee += fee;
    rows.push([day(s.created_at), pairs.get(s.match_request_id) || '-', Number(s.amount_per_session) || 0, Number(s.platform_fee) || 0, fee]);
  }
  rows.push(['합계', `${earned.length}건`, '', '', sumFee]);
  rows.push([]);
  rows.push(['[2] 이 달 지급한 금액 (출금 지급 완료 기준, 원천징수 3.3%)']);
  rows.push(['지급일', '신청 금액', '소득세(3%)', '지방소득세(0.3%)', '실지급액']);
  let g = 0, it = 0, lt = 0, net = 0;
  for (const w of paid) {
    const t = withholding(Number(w.amount));
    g += t.gross; it += t.income; lt += t.local; net += t.net;
    rows.push([day(w.completed_at), t.gross, t.income, t.local, t.net]);
  }
  rows.push(['합계', g, it, lt, net]);
  rows.push([]);
  rows.push(['※ 원천징수 금액은 앱 계산 기준이며, 실제 신고 내용은 회사가 발급하는 원천징수 영수증을 따릅니다.']);
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return { csv, fileName: `dudu_statement_${y}-${String(m).padStart(2, '0')}.csv`, earnedCount: earned.length, sumFee, paidCount: paid.length, net };
}

export function downloadCsv(csv: string, fileName: string) {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
