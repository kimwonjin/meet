import React, { useId, useMemo } from 'react';
import { Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useAuth } from '@/contexts/AuthContext';
import { watermarkLines } from '@/lib/watermark';

// 회원 사진 보호:
// - 하단에 보는 사람 번호와 시각을 흐리게 표시 (캡처가 퍼지면 누가 찍었는지 알 수 있게)
// - 사진 위를 투명한 막으로 덮어 길게 눌러 저장·드래그를 막는다 (웹)
// - 앱에서는 사진이 보이는 동안 캡처·화면 녹화를 막는다 (안드로이드, iOS 13+)
export default function ProtectedPhoto({ uri, style, small }: { uri: string; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const { user } = useAuth();
  // 같은 화면에 사진이 여러 장이어도 각자 잠그고 푼다
  const key = useId();
  if (Platform.OS !== 'web') usePreventScreenCapture(key); // 플랫폼은 실행 중 바뀌지 않으므로 훅 순서가 일정하다
  const lines = useMemo(() => watermarkLines(user?.id), [user?.id]);
  return (
    <View style={[styles.wrap, style]} {...({ dataSet: { protectedPhoto: '1' } } as any)}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" draggable={false} />
      <View style={styles.shield} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {!small && (
          <Text style={styles.mark} selectable={false} accessibilityLabel="사진 보호 표시">
            {lines[0]}{'\n'}{lines[1]}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#F1ECFF' },
  // 사진 전체를 덮는 투명 막: 사진을 직접 누를 수 없게 해서 '이미지 저장' 메뉴가 뜨지 않는다
  shield: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8, userSelect: 'none' } as any,
  mark: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 2,
    letterSpacing: 0.3,
    lineHeight: 13,
    textAlign: 'center',
  },
});
