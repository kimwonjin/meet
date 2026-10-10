import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type DistributionRow = { label: string; count: number; color: string };

// 지역은 항목마다 색이 정해져 있다 (순위가 바뀌어도 같은 지역은 같은 색)
const REGION_COLORS: Record<string, string> = {
  서울: '#2a78d6',
  경기: '#eb6834',
  인천: '#1baf7a',
  강원: '#eda100',
  충청: '#e87ba4',
  전라: '#008300',
  경상: '#4a3aa7',
  제주: '#e34948',
};
export const MUTED_COLOR = '#C9C9D1';
export function regionColor(label: string) {
  return REGION_COLORS[label] ?? MUTED_COLOR;
}

// 연령대는 순서가 있으므로 강조색 한 가지의 밝기 단계로 (어릴수록 밝게).
// 실제로 있는 연령대들에 단계를 고르게 나눠, 이웃한 연령대도 구분되게 한다.
const AGE_RAMP = ['#C9B8FF', '#AA8DFF', '#8A62FF', '#6E3BFF', '#5B21FF', '#4614D1', '#330DA0', '#230873'];
export function ageColors(count: number) {
  if (count <= 1) return [AGE_RAMP[4]];
  return Array.from({ length: count }, (_, i) => AGE_RAMP[Math.round((i * (AGE_RAMP.length - 1)) / (count - 1))]);
}

// 누적 가로 막대 하나 + 아래 범례(이름·인원·비율)
export default function StackedBar({ rows }: { rows: DistributionRow[]; total?: number }) {
  const shown = rows.filter((r) => r.count > 0);
  // 비율은 막대에 실제로 그린 항목 합계 기준 (나이·지역 미입력 등으로 빠진 사람이 있어도 100%가 되게)
  const total = shown.reduce((sum, r) => sum + r.count, 0);
  return (
    <View>
      <View style={styles.bar} accessible accessibilityLabel={shown.map((r) => `${r.label} ${r.count}명`).join(', ')}>
        {shown.map((r, i) => (
          <View
            key={r.label}
            style={[
              styles.segment,
              { flex: r.count, backgroundColor: r.color },
              i === 0 && styles.first,
              i === shown.length - 1 && styles.last,
              i > 0 && styles.gap,
            ]}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {shown.map((r) => (
          <View key={r.label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: r.color }]} />
            <Text style={styles.legendText}>
              {r.label} {r.count}
              <Text style={styles.pct}> ({total > 0 ? Math.round((r.count / total) * 100) : 0}%)</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// 두 항목 비교(예: 남·여): 막대 하나 안에 왼쪽·오른쪽으로 이름과 인원을 바로 적는다
export function SplitBar({ left, right }: { left: DistributionRow; right: DistributionRow; total?: number }) {
  const total = left.count + right.count;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const label = (r: DistributionRow) => `${r.label} ${r.count}명 (${pct(r.count)}%)`;
  return (
    <View style={styles.splitBar} accessible accessibilityLabel={`${label(left)}, ${label(right)}`}>
      {left.count > 0 && (
        <View style={[styles.splitSeg, { flex: left.count, backgroundColor: left.color }, styles.first, right.count === 0 && styles.last]}>
          <Text style={styles.splitText} numberOfLines={1}>{label(left)}</Text>
        </View>
      )}
      {right.count > 0 && (
        <View style={[styles.splitSeg, styles.splitRight, { flex: right.count, backgroundColor: right.color }, styles.last, left.count > 0 ? styles.gap : styles.first]}>
          <Text style={styles.splitText} numberOfLines={1}>{label(right)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', height: 14, borderRadius: 4, overflow: 'hidden', backgroundColor: '#F1EFF4' },
  segment: { height: 14 },
  first: { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  last: { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  gap: { marginLeft: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: '#322F38' },
  pct: { color: '#98959E' },
  splitBar: { flexDirection: 'row', height: 28, borderRadius: 6, overflow: 'hidden', backgroundColor: '#F1EFF4' },
  splitSeg: { height: 28, justifyContent: 'center', paddingHorizontal: 8, minWidth: 0 },
  splitRight: { alignItems: 'flex-end' },
  splitText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
