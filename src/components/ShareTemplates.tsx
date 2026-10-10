import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '@/contexts/ToastContext';
import { fetchShareTemplates, fillTemplate, ShareTemplate } from '@/lib/invite';

// 상황별 홍보 문구. 운영자가 정한 문구만 쓰고, 연결자가 직접 쓰는 칸은 두지 않는다 (과장 광고 방지).
export default function ShareTemplates({ link, onLoaded }: { link: string; onLoaded?: (count: number) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ShareTemplate[] | null>(null);

  useEffect(() => {
    fetchShareTemplates().then((t) => {
      setItems(t);
      onLoaded?.(t.length);
    });
  }, []);

  async function copy(t: ShareTemplate) {
    try {
      await Clipboard.setStringAsync(fillTemplate(t.body, link));
      toast.show(`'${t.title}' 문구를 복사했어요. 카톡에 붙여넣어 보내세요`, 'success');
    } catch {
      toast.show('복사하지 못했어요. 문구를 길게 눌러 복사해주세요', 'error');
    }
  }

  if (items === null) return <ActivityIndicator color="#5B21FF" style={{ marginVertical: 12 }} />;
  if (items.length === 0) return <Text style={styles.empty}>준비된 문구가 없어요</Text>;
  return (
    <View style={styles.list}>
      {items.map((t) => (
        <View key={t.id} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>{t.title}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={() => copy(t)} accessibilityLabel={`${t.title} 문구 복사`}>
              <Text style={styles.copyText}>복사</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.body} selectable>{fillTemplate(t.body, link)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  card: { backgroundColor: '#F7F4FF', borderRadius: 12, padding: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  copyBtn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  copyText: { color: '#5B21FF', fontSize: 13, fontWeight: '600' },
  body: { fontSize: 13, color: '#434049', lineHeight: 19 },
  empty: { fontSize: 13, color: '#98959E', textAlign: 'center', paddingVertical: 8 },
});
