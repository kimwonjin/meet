import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useToast } from '@/contexts/ToastContext';
import { approveJoin, findPendingJoin } from '@/lib/join';

// 파트너 채팅방 위 띠: 이 회원이 나에게 가입 신청을 했으면 대화하다가 바로 승인할 수 있다
// (신청이 없으면 아무것도 보이지 않음)
export default function JoinChatBanner({
  partner, memberId, memberName, threadId, onApproved,
}: {
  partner: { id: string; name?: string | null }; memberId: string; memberName: string; threadId: string | null; onApproved?: () => void;
}) {
  const toast = useToast();
  const [req, setReq] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    setReq(null);
    setDone(false);
    findPendingJoin(memberId, partner.id).then((r) => { if (alive) setReq(r); }).catch(() => {});
    return () => { alive = false; };
  }, [memberId, partner.id]);

  if (done) {
    return (
      <View style={styles.box}>
        <Text style={styles.title}>✓ {memberName}님을 내 회원으로 승인했어요</Text>
      </View>
    );
  }
  if (!req) return null;

  async function approve() {
    if (busy || !req) return;
    setBusy(true);
    try {
      const r = await approveJoin(req.id, memberId, partner, threadId);
      if (r === 'gone') {
        toast.show('이미 처리됐거나 탈퇴한 회원이에요', 'info');
        setReq(null);
        return;
      }
      setDone(true);
      onApproved?.();
    } catch {
      toast.show('승인하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box} accessibilityLabel="받은 가입 신청">
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>🙋 {memberName}님이 가입을 신청했어요</Text>
        <Text style={styles.body}>대화해 보고 괜찮으면 바로 승인하세요. 거절은 회원 탭 › 대기중에서 해요</Text>
      </View>
      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={approve} disabled={busy} accessibilityLabel="가입 승인">
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>승인</Text>}
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
  title: { fontSize: 14, fontWeight: '700', color: '#18151E' },
  body: { fontSize: 13, color: '#65626B', marginTop: 4 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, minWidth: 64, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
