import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { fetchMyBlocks, unblockUser } from '@/lib/safety';

// 마이 › 차단 목록: 내가 차단한 사람을 보고 풀 수 있다
export default function BlockListSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<{ id: string; name: string; created_at: string }[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    setItems(null);
    fetchMyBlocks(user.id).then(setItems);
  }, [visible, user?.id]);

  async function unblock(id: string, name: string) {
    if (!user || busyId) return;
    setBusyId(id);
    const ok = await unblockUser(user.id, id);
    setBusyId(null);
    if (!ok) {
      toast.show('차단을 풀지 못했어요. 잠시 후 다시 시도해주세요', 'error');
      return;
    }
    setItems((list) => (list || []).filter((x) => x.id !== id));
    toast.show(`${name}님 차단을 풀었어요`, 'success');
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="차단 목록">
      {items === null ? (
        <ActivityIndicator color="#5B21FF" style={{ marginVertical: 24 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>차단한 사람이 없어요</Text>
      ) : (
        items.map((b) => (
          <View key={b.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{b.name}</Text>
              <Text style={styles.date}>{new Date(b.created_at).toLocaleDateString('ko-KR')} 차단</Text>
            </View>
            <TouchableOpacity style={styles.btn} onPress={() => unblock(b.id, b.name)} disabled={busyId !== null}>
              {busyId === b.id ? <ActivityIndicator size="small" color="#5B21FF" /> : <Text style={styles.btnText}>차단 해제</Text>}
            </TouchableOpacity>
          </View>
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: '#999', fontSize: 14, marginVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  name: { fontSize: 15, fontWeight: '600', color: '#222' },
  date: { fontSize: 12, color: '#999', marginTop: 2 },
  btn: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 80, alignItems: 'center' },
  btnText: { fontSize: 13, color: '#555' },
});
