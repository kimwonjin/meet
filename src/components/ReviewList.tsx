import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatStars, Review } from '@/lib/reviews';

// 파트너 후기 목록: 평균 별점 + 최신 후기 3개, 나머지는 '더 보기'로 펼친다 (세로 목록)
export default function ReviewList({ reviews, emptyText = '아직 후기가 없어요' }: { reviews: Review[] | null; emptyText?: string }) {
  const [showAll, setShowAll] = useState(false);

  if (reviews === null) return <ActivityIndicator color="#5B21FF" style={styles.loading} />;
  if (reviews.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;

  const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
  return (
    <View>
      <Text style={styles.summary}>★ {avg.toFixed(1)} · 후기 {reviews.length}개</Text>
      {(showAll ? reviews : reviews.slice(0, 3)).map((r) => (
        <View key={r.id} style={styles.item}>
          <View style={styles.head}>
            <Text style={styles.stars}>{formatStars(r.rating)}</Text>
            <Text style={styles.meta}>{r.writerName} · {new Date(r.created_at).toLocaleDateString('ko-KR')}</Text>
          </View>
          {!!r.content && <Text style={styles.content}>{r.content}</Text>}
        </View>
      ))}
      {!showAll && reviews.length > 3 && (
        <TouchableOpacity onPress={() => setShowAll(true)} style={styles.more}>
          <Text style={styles.moreText}>후기 {reviews.length - 3}개 더 보기</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 12 },
  empty: { fontSize: 13, color: '#666', lineHeight: 20 },
  summary: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 4 },
  item: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f2f2f2' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  stars: { color: '#5B21FF', fontSize: 13 },
  meta: { color: '#999', fontSize: 12 },
  content: { fontSize: 13, color: '#666', lineHeight: 20 },
  more: { paddingVertical: 12, alignItems: 'center' },
  moreText: { color: '#5B21FF', fontSize: 13, fontWeight: '600' },
});
