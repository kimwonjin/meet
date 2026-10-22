// 운영자 전체 공지: 대상(전체·회원·파트너)을 골라 알림으로 보낸다 (휴대폰 알림을 켠 사람은 휴대폰으로도)
// 보낸 공지는 운영자 알림함에도 한 건 남는다 (보낸 기록)
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';

type Target = 'all' | 'hopeful' | 'connector';
const TARGETS: [Target, string][] = [['all', '전체'], ['hopeful', '회원만'], ['connector', '파트너만']];

async function recipients(target: Target) {
  let q = supabase.from('users').select('id').is('withdrawn_at', null).is('suspended_at', null);
  q = target === 'all' ? q.in('role', ['hopeful', 'connector']) : q.eq('role', target);
  const { data, error } = await q;
  if (error) throw error;
  return ((data || []) as any[]).map((u) => u.id as string);
}

export default function NoticeComposer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [target, setTarget] = useState<Target>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setCount(null);
    recipients(target).then((ids) => alive && setCount(ids.length)).catch(() => alive && setCount(0));
    return () => { alive = false; };
  }, [visible, target]);

  async function send() {
    if (!user || sending) return;
    if (!title.trim()) { toast.show('제목을 입력해 주세요', 'error'); return; }
    if (!count) { toast.show('받을 사람이 없어요', 'info'); return; }
    const label = TARGETS.find((t) => t[0] === target)![1];
    // 여러 사람에게 한꺼번에 가고 되돌릴 수 없으므로 한 번 더 확인한다
    const ok = await confirm({ title: `${label} ${count ?? 0}명에게 보낼까요?`, message: `"${title.trim()}"\n보낸 공지는 취소할 수 없어요`, confirmText: '보내기' });
    if (!ok) return;
    setSending(true);
    try {
      const ids = await recipients(target);
      const rows = [...ids, user.id].map((id) => ({
        user_id: id,
        type: 'notice',
        title: id === user.id ? `[보낸 공지 · ${label} ${ids.length}명] ${title.trim()}` : `📢 ${title.trim()}`,
        body: body.trim() || null,
        deep_link_route: '/home',
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('notifications').insert(rows.slice(i, i + 500));
        if (error) throw error;
      }
      toast.show(`✓ ${ids.length}명에게 공지를 보냈어요`, 'success');
      setTitle(''); setBody('');
      onClose();
    } catch {
      toast.show('보내지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="공지 보내기"
      footer={
        <TouchableOpacity style={[s.btn, (sending || !title.trim() || count === 0) && { opacity: 0.6 }]} onPress={send} disabled={sending || !title.trim() || !count} accessibilityLabel="공지 보내기 확정">
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>{count === null ? '보내기' : count === 0 ? '받을 사람이 없어요' : `${count}명에게 보내기`}</Text>}
        </TouchableOpacity>
      }
    >
      <View style={{ gap: 8, paddingBottom: 4 }}>
        <Text style={s.label}>받는 사람</Text>
        <View style={s.row}>
          {TARGETS.map(([k, l]) => (
            <TouchableOpacity key={k} style={[s.chip, target === k && s.chipOn]} onPress={() => setTarget(k)} accessibilityLabel={`받는 사람 ${l}`} accessibilityState={{ selected: target === k }}>
              <Text style={[s.chipT, target === k && s.chipTOn]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>제목</Text>
        <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="예: 10월 30일 새벽 점검 안내" placeholderTextColor="#BAB7C0" maxLength={60} accessibilityLabel="공지 제목" />
        <Text style={s.label}>내용 <Text style={s.opt}>선택</Text></Text>
        <TextInput style={[s.input, s.multi]} value={body} onChangeText={setBody} placeholder="알림에 함께 보여요" placeholderTextColor="#BAB7C0" multiline maxLength={300} accessibilityLabel="공지 내용" />
        <Text style={s.note}>탈퇴·정지한 계정은 빼고 보내요. 휴대폰 알림을 켠 사람은 휴대폰으로도 받아요</Text>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: '#322F38', marginTop: 6 },
  opt: { fontSize: 11, fontWeight: '400', color: '#98959E' },
  row: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 999, borderWidth: 1, borderColor: '#DCD9E2', justifyContent: 'center' },
  chipOn: { borderColor: '#5B21FF', backgroundColor: '#F5F1FF' },
  chipT: { fontSize: 13, color: '#65626B' },
  chipTOn: { color: '#5B21FF', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, paddingHorizontal: 12, height: 46, fontSize: 15, color: '#322F38' },
  multi: { height: 96, paddingTop: 12, textAlignVertical: 'top' },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18, marginTop: 6 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
