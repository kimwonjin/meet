import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InviteStats } from '@/lib/invite';

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');

// 광고하기 › 초대 성과: 합계 4칸 + 단계별 전환 + 최근 30일 막대
export default function InviteStatsView({ stats }: { stats: InviteStats }) {
  const t = stats.totals;
  const tiles = [
    { label: '링크 열람', value: t.CLICK },
    { label: '가입', value: t.SIGNUP },
    { label: '가입 신청', value: t.APPLIED },
    { label: '승인', value: t.APPROVED },
  ];
  const daily = stats.daily || [];
  const max = Math.max(1, ...daily.map((d) => Number(d.CLICK) || 0));
  const recent = daily.reduce((s, d) => s + (Number(d.CLICK) || 0), 0);

  if (t.CLICK + t.SIGNUP + t.APPLIED + t.APPROVED === 0) {
    return <Text style={styles.empty}>아직 기록이 없어요. 초대장을 보내면 여기에서 몇 명이 열어 보고 가입했는지 볼 수 있어요.</Text>;
  }

  return (
    <View>
      <View style={styles.tiles}>
        {tiles.map((x) => (
          <View key={x.label} style={styles.tile} accessibilityLabel={`${x.label} ${x.value}`}>
            <Text style={styles.tileValue}>{Number(x.value).toLocaleString()}</Text>
            <Text style={styles.tileLabel}>{x.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.rates}>
        <Text style={styles.rate}>링크를 연 사람 중 가입 신청 <Text style={styles.rateValue}>{pct(t.APPLIED, t.CLICK)}</Text></Text>
        <Text style={styles.rate}>가입 신청 중 승인 <Text style={styles.rateValue}>{pct(t.APPROVED, t.APPLIED)}</Text></Text>
      </View>
      {daily.length > 0 && (
        <>
          <Text style={styles.chartTitle}>최근 30일 링크 열람 · {recent}회</Text>
          <View style={styles.chart} accessibilityLabel={`최근 30일 링크 열람 ${recent}회`}>
            {daily.map((d) => (
              <View key={d.d} style={styles.barSlot}>
                <View style={[styles.bar, { height: `${Math.max(4, ((Number(d.CLICK) || 0) / max) * 100)}%` }, !(Number(d.CLICK) > 0) && styles.barEmpty]} />
              </View>
            ))}
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisText}>30일 전</Text>
            <Text style={styles.axisText}>오늘</Text>
          </View>
        </>
      )}
      <Text style={styles.note}>같은 사람이 여러 번 열어도 한 번만 세고, 검색엔진 같은 자동 방문은 빼요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 13, color: '#888', lineHeight: 19 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, backgroundColor: '#F7F7F9', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  tileValue: { fontSize: 17, fontWeight: '700', color: '#222' },
  tileLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  rates: { marginTop: 12, gap: 4 },
  rate: { fontSize: 13, color: '#555' },
  rateValue: { fontWeight: '700', color: '#5B21FF' },
  chartTitle: { fontSize: 12, color: '#888', marginTop: 16, marginBottom: 6 },
  chart: { height: 56, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: '#5B21FF', borderRadius: 2 },
  barEmpty: { backgroundColor: '#E8E8EE' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { fontSize: 11, color: '#aaa' },
  note: { fontSize: 11, color: '#aaa', marginTop: 12, lineHeight: 16 },
});
