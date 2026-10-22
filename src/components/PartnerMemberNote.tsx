// 파트너가 내 회원 프로필에서 쓰는 '직접 만나 확인' 표시와 나만 보는 메모
// 메모는 입력을 멈추면 1초 뒤 자동 저장, 시트를 닫을 때도 저장한다
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useToast } from '@/contexts/ToastContext';
import { getMemberNote, MemberNote, saveMemberNote, setIdentityChecked } from '@/lib/memberNotes';

export default function PartnerMemberNote({ connectorId, memberId, onCheckedChange }: { connectorId: string; memberId: string; onCheckedChange?: (checked: boolean) => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<MemberNote | null>(null);
  const [note, setNote] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [checking, setChecking] = useState(false);
  const dirty = useRef(false);
  const latest = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getMemberNote(connectorId, memberId).then((r) => { if (alive) { setInfo(r); setNote(r.note); latest.current = r.note; } });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      // 닫을 때 저장 안 된 내용이 있으면 저장한다
      if (dirty.current) saveMemberNote(connectorId, memberId, latest.current);
    };
  }, [connectorId, memberId]);

  async function save() {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState('saving');
    const ok = await saveMemberNote(connectorId, memberId, latest.current);
    setSaveState(ok ? 'saved' : 'error');
    if (!ok) dirty.current = true;
  }

  function onChange(v: string) {
    setNote(v);
    latest.current = v;
    dirty.current = true;
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 1000);
  }

  async function toggleCheck() {
    if (!info || checking) return;
    const next = !info.checkedAt;
    setChecking(true);
    const r = await setIdentityChecked(connectorId, memberId, next);
    setChecking(false);
    if (!r.ok) { toast.show('저장하지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    setInfo({ ...info, checkedAt: r.at });
    onCheckedChange?.(next);
    toast.show(next ? '✓ 직접 만나 확인한 회원으로 표시했어요' : '확인 표시를 지웠어요', next ? 'success' : 'info');
  }

  if (!info) return <ActivityIndicator color="#5B21FF" style={{ marginVertical: 16 }} />;
  if (!info.available && !info.checkAvailable) return null;

  return (
    <View style={s.wrap}>
      {info.checkAvailable && (
        <TouchableOpacity style={s.checkRow} onPress={toggleCheck} disabled={checking} accessibilityRole="checkbox" accessibilityState={{ checked: !!info.checkedAt }} accessibilityLabel="직접 만나 신분을 확인했어요">
          <View style={[s.box, !!info.checkedAt && s.boxOn]}>
            {checking ? <ActivityIndicator size="small" color={info.checkedAt ? '#fff' : '#5B21FF'} /> : !!info.checkedAt && <Text style={s.boxMark}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.checkTitle}>직접 만나 신분을 확인했어요</Text>
            <Text style={s.checkSub}>{info.checkedAt ? `${new Date(info.checkedAt).getMonth() + 1}월 ${new Date(info.checkedAt).getDate()}일 확인 · 소개받는 상대와 다른 파트너에게 '파트너 확인'으로 보여요` : "켜면 소개받는 상대와 다른 파트너에게 '파트너 확인'으로 보여요"}</Text>
          </View>
        </TouchableOpacity>
      )}
      {info.available && (
        <View style={{ marginTop: 14 }}>
          <View style={s.noteHead}>
            <Text style={s.noteTitle}>📝 메모 <Text style={s.noteOnly}>나만 보여요</Text></Text>
            <Text style={s.saveState}>{saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? '✓ 저장됨' : saveState === 'error' ? '저장 실패 · 다시 입력해 주세요' : ''}</Text>
          </View>
          <TextInput
            style={s.input}
            value={note}
            onChangeText={onChange}
            onBlur={save}
            placeholder="선호하는 조건, 상담 내용 등 기억할 점을 적어 두세요"
            placeholderTextColor="#BAB7C0"
            multiline
            maxLength={2000}
            accessibilityLabel="회원 메모"
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F1EFF4' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: '#BAB7C0', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#5B21FF', borderColor: '#5B21FF' },
  boxMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  checkTitle: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  checkSub: { fontSize: 12, color: '#87848D', marginTop: 2, lineHeight: 17 },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  noteTitle: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  noteOnly: { fontSize: 11, fontWeight: '400', color: '#98959E' },
  saveState: { fontSize: 11, color: '#98959E' },
  input: { minHeight: 88, borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, padding: 12, fontSize: 14, color: '#322F38', textAlignVertical: 'top' },
});
