// 요금표: 파트너별 1회 소개 비용 + 이용권·환불 기준 (결혼중개업법 제8조 ②: 홈페이지에 수수료표 게시)
// 화면 맨 아래 사업자 정보 줄에서 연다
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { supabase } from '@/lib/supabase';

type Row = { id: string; name: string; fee: number };

async function fetchFees(): Promise<Row[]> {
  const { data } = await supabase.from('connectors').select('id, business_name, fee_per_session').eq('status', 'approved');
  const rows = ((data || []) as any[]).filter((c) => Number(c.fee_per_session) > 0);
  if (!rows.length) return [];
  const { data: users } = await supabase.from('users').select('id, name, withdrawn_at, suspended_at').in('id', rows.map((c) => c.id));
  const ok = new Map(((users || []) as any[]).filter((u) => !u.withdrawn_at && !u.suspended_at).map((u) => [u.id, u.name]));
  return rows
    .filter((c) => ok.has(c.id))
    .map((c) => ({ id: c.id, name: c.business_name || ok.get(c.id) || '파트너', fee: Number(c.fee_per_session) }))
    .sort((a, b) => a.fee - b.fee || a.name.localeCompare(b.name));
}

export function FeeTableSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setRows(null);
    fetchFees().then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [visible]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="요금표">
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text style={s.lead}>소개 1회 비용은 담당 파트너마다 달라요. 이용권은 원하는 횟수만큼 사고, 만남이 정상적으로 마무리될 때 1회씩 차감돼요.</Text>
        <View style={s.table}>
          <View style={[s.row, s.head]}>
            <Text style={[s.cName, s.headT]}>담당 파트너</Text>
            <Text style={[s.cFee, s.headT]}>소개 1회</Text>
          </View>
          {!rows ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 16 }} /> : rows.length === 0 ? (
            <Text style={s.empty}>지금 활동 중인 파트너가 없어요</Text>
          ) : rows.map((r) => (
            <View key={r.id} style={s.row}>
              <Text style={s.cName} numberOfLines={1}>{r.name}</Text>
              <Text style={s.cFee}>{r.fee.toLocaleString()}원</Text>
            </View>
          ))}
        </View>
        <View style={s.box}>
          <Text style={s.boxT}>가입비·월회비</Text>
          <Text style={s.boxB}>없어요. 이용권 외에 따로 내는 돈은 없어요.</Text>
          <Text style={s.boxT}>차감되지 않는 경우</Text>
          <Text style={s.boxB}>상대가 나오지 않은 노쇼, 매칭 취소·거절은 이용권이 차감되지 않아요.</Text>
          <Text style={s.boxT}>환불</Text>
          <Text style={s.boxB}>결제 후 7일 안에 하나도 쓰지 않았으면 전액, 그 뒤에는 쓰지 않은 이용권과 충전 잔액을 수수료 없이 돌려드려요. 회사(파트너 포함) 잘못으로 소개를 못 받으면 기간과 관계없이 전액 환불해요. (이용약관 제9조)</Text>
        </View>
      </View>
    </BottomSheet>
  );
}

export function FeeTableLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} accessibilityLabel="요금표" hitSlop={8}>
        <Text style={s.link}>요금표 · 환불 기준</Text>
      </TouchableOpacity>
      <FeeTableSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 14, color: '#434049', lineHeight: 21 },
  table: { borderWidth: 1, borderColor: '#ECEAF1', borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F3F1F6' },
  head: { backgroundColor: '#F8F7FA' },
  headT: { fontSize: 12, color: '#6E6A75', fontWeight: '600' },
  cName: { flex: 1, fontSize: 14, color: '#322F38', paddingRight: 8 },
  cFee: { fontSize: 14, color: '#322F38', fontWeight: '700', textAlign: 'right' },
  empty: { fontSize: 13, color: '#736F7A', textAlign: 'center', paddingVertical: 16 },
  box: { backgroundColor: '#F8F7FA', borderRadius: 12, padding: 14, gap: 4 },
  boxT: { fontSize: 13, fontWeight: '700', color: '#322F38', marginTop: 4 },
  boxB: { fontSize: 13, color: '#54515A', lineHeight: 19 },
  link: { fontSize: 12, color: '#54515A', textDecorationLine: 'underline', textAlign: 'center' },
});
