import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type DistributionRow = { label: string; count: number; muted?: boolean };

interface Props {
  rows: DistributionRow[];
  total: number; // 비율(%) 계산 기준
}

// 가로 막대 목록: 항목 이름 · 막대 · 인원(비율)
// 크기만 비교하므로 강조색 한 가지로 그리고, 숫자는 막대 색이 아닌 본문 글자색으로 쓴다.
// 막대 길이는 가장 많은 항목을 기준으로 해서 차이가 잘 보이게 한다.
export default function DistributionBars({ rows, total }: Props) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <View style={styles.list}>
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <View
            key={r.label}
            style={styles.row}
            accessible
            accessibilityLabel={`${r.label} ${r.count}명, ${pct}퍼센트`}
          >
            <Text style={[styles.label, r.muted && styles.mutedText]} numberOfLines={1}>{r.label}</Text>
            <View style={styles.track}>
              <View style={[styles.bar, r.muted && styles.mutedBar, { width: `${(r.count / max) * 100}%` }]} />
            </View>
            <Text style={styles.value}>
              {r.count}명 <Text style={styles.pct}>{pct}%</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 22 },
  label: { width: 68, fontSize: 13, color: '#444' },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#F1F1F4', overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5, backgroundColor: '#5B21FF', minWidth: 4 },
  mutedBar: { backgroundColor: '#C9C9D1' },
  mutedText: { color: '#999' },
  value: { width: 70, textAlign: 'right', fontSize: 13, fontWeight: '600', color: '#222' },
  pct: { fontWeight: '400', color: '#999' },
});
