import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

// 연결 확인용 외부 주소 호출은 하지 않는다 (기기의 연결 상태만 본다)
if (Platform.OS !== 'web') NetInfo.configure({ reachabilityShouldRun: () => false });

// 인터넷이 끊기면 화면 맨 위에 안내를 띄운다
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      // 웹은 브라우저의 온라인/오프라인 신호를 바로 쓴다
      if (typeof window === 'undefined') return;
      const update = () => setOffline(!navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }
    return NetInfo.addEventListener((state) => setOffline(state.isConnected === false));
  }, []);

  if (!offline) return null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]} pointerEvents="none">
      <Text style={styles.text}>인터넷 연결이 끊겼어요. 연결되면 자동으로 다시 불러와요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000, backgroundColor: '#333', paddingBottom: 8, paddingHorizontal: 16 },
  text: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
