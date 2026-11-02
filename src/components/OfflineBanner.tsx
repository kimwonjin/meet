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
      // 웹의 오프라인 신호는 잠깐 끊겼다 붙을 때(와이파이↔데이터 전환, 화면 잠금 해제)도 오고,
      // 아이폰 사파리는 다시 연결돼도 online 신호를 안 줄 때가 있다.
      // → 3초 넘게 이어질 때만 띄우고, 띄운 동안에는 실제로 서버에 닿는지 5초마다 확인해 닿으면 바로 내린다
      if (typeof window === 'undefined') return;
      let showTimer: ReturnType<typeof setTimeout> | null = null;
      let checkTimer: ReturnType<typeof setInterval> | null = null;
      const reachable = async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          const r = await fetch(`/favicon.ico?ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
          clearTimeout(t);
          return r.ok || r.status > 0;
        } catch { return false; }
      };
      const stopChecks = () => { if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } };
      const goOnline = () => { if (showTimer) { clearTimeout(showTimer); showTimer = null; } stopChecks(); setOffline(false); };
      const maybeOffline = () => {
        if (showTimer || checkTimer) return;
        showTimer = setTimeout(async () => {
          showTimer = null;
          if (navigator.onLine || (await reachable())) { goOnline(); return; }
          setOffline(true);
          checkTimer = setInterval(async () => { if (await reachable()) goOnline(); }, 5000);
        }, 3000);
      };
      const update = () => (navigator.onLine ? goOnline() : maybeOffline());
      // 화면으로 돌아오면 다시 확인 (사파리가 신호를 놓친 경우)
      const recheck = () => { if (document.visibilityState === 'visible') reachable().then((ok) => ok && goOnline()); };
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      window.addEventListener('focus', recheck);
      document.addEventListener('visibilitychange', recheck);
      return () => {
        goOnline();
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
        window.removeEventListener('focus', recheck);
        document.removeEventListener('visibilitychange', recheck);
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
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000, backgroundColor: '#322F38', paddingBottom: 8, paddingHorizontal: 16 },
  text: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
