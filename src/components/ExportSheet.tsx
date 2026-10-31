// 운영자: 월별 정산·출금 내역을 엑셀(CSV)로 내려받기
// - 정산 내역: 만남 한 건마다 (파트너·회원·금액·수수료·정산금·지급 상태)
// - 파트너별 합계: 그 달 파트너마다 건수·정산금·수수료 합계 (세금·장부용)
// - 출금 내역: 이체할 계좌 정보 포함
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { downloadCsv, text, ymd } from '@/lib/csv';

type Kind = 'settlements' | 'partners' | 'withdrawals';

async function names(ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map<string, string>();
  const [{ data: users }, { data: conns }] = await Promise.all([
    supabase.from('users').select('id, name').in('id', list),
    supabase.from('connectors').select('id, business_name').in('id', list),
  ]);
  const biz = new Map(((conns || []) as any[]).map((c) => [c.id, c.business_name]));
  return new Map(((users || []) as any[]).map((u) => [u.id as string, biz.get(u.id) ? `${u.name} (${biz.get(u.id)})` : (u.name as string)]));
}

export default function ExportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [busy, setBusy] = useState<Kind | null>(null);
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth() + 1;
  const move = (by: number) => { const d = new Date(ym.y, ym.m - 1 + by, 1); setYm({ y: d.getFullYear(), m: d.getMonth() + 1 }); };
  const start = new Date(ym.y, ym.m - 1, 1).toISOString();
  const end = new Date(ym.y, ym.m, 1).toISOString();
  const tag = `${ym.y}-${String(ym.m).padStart(2, '0')}`;

  async function run(kind: Kind) {
    if (busy) return;
    setBusy(kind);
    try {
      let rows: any[][] = [];
      let file = '';
      if (kind === 'withdrawals') {
        const { data, error } = await supabase.from('withdrawal_requests').select('*').gte('requested_at', start).lt('requested_at', end).order('requested_at');
        if (error) throw error;
        const nm = await names((data || []).map((w: any) => w.connector_id));
        rows = [['신청일', '파트너', '금액', '상태', '지급일', '은행', '계좌번호', '예금주'],
          ...((data || []) as any[]).map((w) => [ymd(w.requested_at), nm.get(w.connector_id) || '', Number(w.amount), w.status === 'completed' ? '지급 완료' : '대기', ymd(w.completed_at), w.bank_name, text(w.account_number), w.account_holder])];
        file = `dudu_withdrawals_${tag}.csv`;
      } else {
        const { data, error } = await supabase.from('settlements').select('*').gte('created_at', start).lt('created_at', end).order('created_at');
        if (error) throw error;
        const list = (data || []) as any[];
        const nm = await names([...list.map((s) => s.connector_id), ...list.map((s) => s.hopeful_id)]);
        if (kind === 'settlements') {
          rows = [['정산일', '파트너', '회원', '1회 금액', '수수료', '파트너 정산금', '지급 상태'],
            ...list.map((s) => [ymd(s.created_at), nm.get(s.connector_id) || '', nm.get(s.hopeful_id) || '탈퇴회원', Number(s.amount_per_session), Number(s.platform_fee), Number(s.connector_payout), s.status === 'paid' ? '지급' : '대기'])];
          file = `dudu_settlements_${tag}.csv`;
        } else {
          const by = new Map<string, { n: number; payout: number; fee: number; total: number }>();
          for (const s of list) {
            const v = by.get(s.connector_id) || { n: 0, payout: 0, fee: 0, total: 0 };
            v.n += 1; v.payout += Number(s.connector_payout); v.fee += Number(s.platform_fee); v.total += Number(s.amount_per_session);
            by.set(s.connector_id, v);
          }
          const sorted = [...by.entries()].sort((a, b) => b[1].payout - a[1].payout);
          rows = [['파트너', '정산 건수', '회원 결제 합계', '수수료 합계', '파트너 정산금 합계'],
            ...sorted.map(([id, v]) => [nm.get(id) || '', v.n, v.total, v.fee, v.payout]),
            ['합계', sorted.reduce((n, [, v]) => n + v.n, 0), sorted.reduce((n, [, v]) => n + v.total, 0), sorted.reduce((n, [, v]) => n + v.fee, 0), sorted.reduce((n, [, v]) => n + v.payout, 0)]];
          file = `dudu_partner_totals_${tag}.csv`;
        }
      }
      if (rows.length <= 1) { toast.show(`${ym.m}월에는 내역이 없어요`, 'info'); return; }
      if (!downloadCsv(file, rows)) { toast.show('웹 브라우저에서 내려받을 수 있어요', 'info'); return; }
      toast.show(`✓ ${file} (${rows.length - 1}줄)`, 'success');
    } catch {
      toast.show('내려받지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    } finally {
      setBusy(null);
    }
  }

  const item = (kind: Kind, title: string, sub: string) => (
    <TouchableOpacity key={kind} style={s.item} onPress={() => run(kind)} disabled={!!busy} accessibilityLabel={`${title} 내려받기`}>
      <View style={{ flex: 1 }}>
        <Text style={s.itemT}>{title}</Text>
        <Text style={s.itemS}>{sub}</Text>
      </View>
      {busy === kind ? <ActivityIndicator color="#5B21FF" /> : <Text style={s.itemGo}>내려받기</Text>}
    </TouchableOpacity>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="엑셀로 내려받기">
      <View style={s.monthRow}>
        <TouchableOpacity onPress={() => move(-1)} hitSlop={10} accessibilityLabel="이전 달"><Text style={s.arrow}>‹</Text></TouchableOpacity>
        <Text style={s.month}>{ym.y}년 {ym.m}월</Text>
        <TouchableOpacity onPress={() => !isThisMonth && move(1)} disabled={isThisMonth} hitSlop={10} accessibilityLabel="다음 달"><Text style={[s.arrow, isThisMonth && s.arrowOff]}>›</Text></TouchableOpacity>
      </View>
      <View style={{ gap: 10, paddingBottom: 8 }}>
        {item('settlements', '정산 내역', '만남 한 건마다 금액·수수료·정산금')}
        {item('partners', '파트너별 합계', '파트너마다 건수와 합계 (장부·세금용)')}
        {item('withdrawals', '출금 내역', '이체할 은행·계좌번호·예금주 포함')}
        <Text style={s.note}>엑셀에서 바로 열려요. 계좌번호 등 개인정보가 들어 있으니 보관에 주의해 주세요</Text>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 12 },
  month: { fontSize: 16, fontWeight: '700', color: '#322F38' },
  arrow: { fontSize: 26, color: '#5B21FF', paddingHorizontal: 8 },
  arrowOff: { color: '#DCD9E2' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: '#F8F7FA' },
  itemT: { fontSize: 15, fontWeight: '700', color: '#322F38' },
  itemS: { fontSize: 12, color: '#6E6A75', marginTop: 2 },
  itemGo: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  note: { fontSize: 12, color: '#736F7A', lineHeight: 18, marginTop: 4 },
});
