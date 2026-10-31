// 운영자 현황 탭 '종사자 명단' 줄 + 시트: 활동 중인 파트너 명단, 지난 변경신고 뒤 바뀐 사람, 명단 내려받기, '변경신고 했어요'
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useToast } from '@/contexts/ToastContext';
import { diffStaff, downloadStaffCsv, fetchStaff, getReported, markReported, Reported, Staff } from '@/lib/staffRoster';

export function StaffRosterRow({ style }: { style?: any }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [reported, setReported] = useState<Reported | null>(null);
  const [saving, setSaving] = useState(false);
  const [where, setWhere] = useState<'server' | 'device' | null>(null);
  const load = useCallback(() => { Promise.all([fetchStaff(), getReported()]).then(([s, r]) => { setStaff(s); setReported(r); }).catch(() => setStaff([])); }, []);
  useFocusEffect(load);
  const d = staff ? diffStaff(staff, reported) : null;

  async function done() {
    if (!staff || saving) return;
    setSaving(true);
    const r = await markReported(staff);
    setReported(r.reported); setWhere(r.where);
    setSaving(false);
    toast.show('✓ 지금 명단으로 변경신고를 마친 것으로 기록했어요', 'success');
  }

  return (
    <>
      <TouchableOpacity style={[s.row, d && d.count > 0 && s.rowDue, style]} onPress={() => setOpen(true)} accessibilityLabel="종사자 명단">
        <Text style={s.rowT}>📋 종사자 명단 {staff ? `${staff.length}명` : ''}</Text>
        <Text style={[s.rowSub, d && d.count > 0 && { color: '#E5484D', fontWeight: '700' }]}>{!d ? '' : d.count > 0 ? `변경신고 필요 ${d.count}명 ›` : '신고와 같아요 ›'}</Text>
      </TouchableOpacity>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="종사자 명단">
        {!staff || !d ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 24 }} /> : (
          <View style={{ gap: 14, paddingBottom: 8 }}>
            <Text style={s.lead}>활동 중인 파트너는 회사 결혼중개업의 종사자예요. 파트너가 새로 승인되거나 그만두면 구청에 <Text style={s.b}>변경신고</Text>를 해야 해요 (시행규칙 제3조, 안 하면 과태료).</Text>
            <Text style={s.when}>마지막 변경신고: {reported ? new Date(reported.at).toLocaleDateString('ko-KR') : '기록 없음'}</Text>
            {d.count > 0 && (
              <View style={s.dueBox}>
                <Text style={s.dueT}>신고할 변경 {d.count}건</Text>
                {d.added.map((x) => <Text key={x.id} style={s.dueLine}>＋ 새로: {x.name}{x.business ? ` (${x.business})` : ''}</Text>)}
                {d.removed.map((x) => <Text key={x.id} style={s.dueLine}>－ 그만둠: {x.name}</Text>)}
              </View>
            )}
            <View style={s.table}>
              {staff.length === 0 ? <Text style={s.empty}>활동 중인 파트너가 없어요</Text> : staff.map((x, i) => (
                <View key={x.id} style={s.item}>
                  <Text style={s.no}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{x.name}{x.business ? ` · ${x.business}` : ''}</Text>
                    <Text style={s.sub}>{x.phone} · {x.since.slice(0, 10)}부터</Text>
                  </View>
                </View>
              ))}
            </View>
            <TouchableOpacity style={s.secBtn} onPress={() => { if (downloadStaffCsv(staff)) toast.show('✓ 명단 파일을 받았어요', 'success'); }} accessibilityLabel="종사자 명단 내려받기">
              <Text style={s.secBtnT}>명단 내려받기 (엑셀용 CSV)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, (saving || d.count === 0) && { opacity: 0.5 }]} onPress={done} disabled={saving || d.count === 0} accessibilityLabel="변경신고 했어요">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>{d.count === 0 ? '신고할 변경이 없어요' : '구청에 변경신고 했어요'}</Text>}
            </TouchableOpacity>
            {where === 'device' && <Text style={s.note}>서버에 저장할 칸이 아직 없어 이 기기에만 기록했어요 (add_staff_reported.sql 실행 후 모든 기기에서 같게 보여요).</Text>}
          </View>
        )}
      </BottomSheet>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#ECEAF1', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12 },
  rowDue: { borderColor: '#F5C2C4', backgroundColor: '#FFF6F6' },
  rowT: { fontSize: 14, fontWeight: '600', color: '#322F38' },
  rowSub: { fontSize: 12, color: '#6E6A75' },
  lead: { fontSize: 14, color: '#434049', lineHeight: 21 },
  b: { fontWeight: '700' },
  when: { fontSize: 13, color: '#6E6A75' },
  dueBox: { backgroundColor: '#FFF6F6', borderRadius: 12, padding: 12, gap: 4 },
  dueT: { fontSize: 14, fontWeight: '700', color: '#E5484D' },
  dueLine: { fontSize: 13, color: '#322F38' },
  table: { borderWidth: 1, borderColor: '#ECEAF1', borderRadius: 12, overflow: 'hidden' },
  item: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F1F6' },
  no: { width: 22, fontSize: 13, color: '#736F7A', textAlign: 'right' },
  name: { fontSize: 14, color: '#322F38', fontWeight: '600' },
  sub: { fontSize: 12, color: '#736F7A', marginTop: 2 },
  empty: { fontSize: 13, color: '#736F7A', textAlign: 'center', paddingVertical: 16 },
  secBtn: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#DCD9E2', alignItems: 'center', justifyContent: 'center' },
  secBtnT: { fontSize: 14, color: '#322F38', fontWeight: '600' },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: { fontSize: 12, color: '#736F7A', lineHeight: 18 },
});
