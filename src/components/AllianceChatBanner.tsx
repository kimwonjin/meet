import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useToast } from '@/contexts/ToastContext';
import { acceptAlliance, findIncomingRequest } from '@/lib/alliance';
import { sendMessage } from '@/lib/chat';

// 채팅방 위 띠: 상대 파트너가 나에게 보낸 동맹 요청이 있으면 대화하다가 바로 수락할 수 있다
// (요청이 없거나 내가 파트너가 아니면 아무것도 보이지 않음)
export default function AllianceChatBanner({
  meId, myName, otherId, otherName, threadId, onAccepted,
}: {
  meId: string; myName?: string | null; otherId: string; otherName: string; threadId: string | null; onAccepted?: () => void;
}) {
  const toast = useToast();
  const [alliance, setAlliance] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    setAlliance(null);
    setDone(false);
    findIncomingRequest(meId, otherId).then((a) => { if (alive) setAlliance(a); }).catch(() => {});
    return () => { alive = false; };
  }, [meId, otherId]);

  if (done) {
    return (
      <View style={[styles.box, styles.doneBox]}>
        <Text style={styles.title}>✓ {otherName}님과 동맹을 맺었어요</Text>
        <Text style={styles.body}>이제 서로의 회원을 소개할 수 있어요</Text>
      </View>
    );
  }
  if (!alliance) return null;

  async function accept() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await acceptAlliance(alliance, myName);
      if (r === 'gone') {
        toast.show('상대가 요청을 취소했거나 이미 처리된 요청이에요', 'info');
        setAlliance(null);
        return;
      }
      if (threadId) await sendMessage(threadId, meId, '🤝 동맹 요청을 수락했어요. 잘 부탁드려요!').catch(() => {});
      setDone(true);
      onAccepted?.();
    } catch {
      toast.show('처리 중 오류가 발생했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box} accessibilityLabel="받은 동맹 요청">
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>🤝 {otherName}님이 동맹을 요청했어요</Text>
        <Text style={styles.body}>대화해 보고 괜찮으면 바로 수락하세요</Text>
      </View>
      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={accept} disabled={busy} accessibilityLabel="동맹 수락">
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>수락</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderLeftWidth: 3, borderLeftColor: '#5B21FF', backgroundColor: '#F6F3FF', borderRadius: 6,
  },
  doneBox: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
  title: { fontSize: 14, fontWeight: '700', color: '#18151E' },
  body: { fontSize: 13, color: '#65626B', marginTop: 4 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, minWidth: 64, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
