import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

// 불러오는 동안 보여주는 회색 뼈대 화면 (빙글빙글 대신 화면 모양을 미리 보여준다)
export default function SkeletonScreen({ cards = 3 }: { cards?: number }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.wrap, { opacity: pulse }]} accessibilityLabel="불러오는 중">
      <View style={[styles.bar, { width: '45%', height: 24 }]} />
      <View style={[styles.bar, { width: '30%', height: 14, marginTop: 10 }]} />
      {Array.from({ length: cards }).map((_, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.circle} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={[styles.bar, { width: '50%' }]} />
              <View style={[styles.bar, { width: '75%' }]} />
            </View>
          </View>
          <View style={[styles.bar, { width: '100%', marginTop: 16, height: 36, borderRadius: 10 }]} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 60 },
  bar: { height: 12, borderRadius: 6, backgroundColor: '#ECECF1' },
  card: { marginTop: 20, padding: 16, borderRadius: 14, backgroundColor: '#F7F7FA' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ECECF1' },
});
