import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import StackedBar, { SplitBar, ageColors, regionColor } from './DistributionBars';

// 파트너 회원 구성 (fn_partner_overview 결과): 전체 · 성별 · 성별 연령대 · 지역 막대
export default function PartnerComposition({ ov }: { ov: any }) {
  return (
    <>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>전체 회원</Text>
        <Text style={styles.infoValue}>{ov.total}명</Text>
      </View>
      {ov.total > 0 && (
        <View style={styles.distBlock}>
          <Text style={styles.distLabel}>성별</Text>
          <SplitBar
            total={ov.total}
            left={{ label: '남', count: ov.male, color: '#2a78d6' }}
            right={{ label: '여', count: ov.female, color: '#eb6834' }}
          />
        </View>
      )}
      {ov.ages ? (
        (['M', 'F'] as const).map((g) => {
          const rows = (ov.ages as any[]).filter((a) => a.gender === g);
          if (!rows.length) return null;
          return (
            <View key={g} style={styles.distBlock}>
              <Text style={styles.distLabel}>{g === 'M' ? '남성 연령대' : '여성 연령대'}</Text>
              <StackedBar
                total={g === 'M' ? ov.male : ov.female}
                rows={rows.map((a, i) => ({ label: a.label, count: a.count, color: ageColors(rows.length)[i] }))}
              />
            </View>
          );
        })
      ) : null}
      {ov.regions ? (
        <View style={styles.distBlock}>
          <Text style={styles.distLabel}>지역</Text>
          <StackedBar
            total={ov.total}
            // 많은 순, 지역을 입력하지 않은 회원은 맨 끝에 회색
            rows={[
              ...(ov.regions as any[]).filter((r) => r.label !== '미입력'),
              ...(ov.regions as any[]).filter((r) => r.label === '미입력'),
            ].map((r) => ({ label: r.label, count: r.count, color: regionColor(r.label) }))}
          />
        </View>
      ) : null}
      {!ov.ages && (
        <Text style={styles.distHint}>
          회원이 {ov.min_for_detail}명 이상이 되면 연령대와 지역 분포를 보여드려요 (회원 개인정보 보호)
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 13, color: '#666' },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#333' },
  distBlock: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  distLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  distHint: { fontSize: 12, color: '#999', marginTop: 8, lineHeight: 18 },
});
