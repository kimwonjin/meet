import { DefaultTheme, ThemeProvider } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { APP_MAX_WIDTH, WIDE_BACKDROP } from '@/lib/layout';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { useWebAutoUpdate } from '@/hooks/use-web-auto-update';
import { useWebImageGuard } from '@/hooks/use-web-image-guard';
import { useIosNoInputZoom } from '@/hooks/use-ios-no-input-zoom';
import OfflineBanner from '@/components/OfflineBanner';
import { RouteLinkPreview } from '@/components/LinkPreview';

SplashScreen.preventAutoHideAsync();

// 화면 색이 밝은색으로 짜여 있으므로 폰이 다크모드여도 밝은 화면으로 고정한다 (app.json userInterfaceStyle: light)
function RootLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return <AnimatedSplashOverlay />;
  }

  return (
    <ThemeProvider value={DefaultTheme}>
      <StatusBar style="dark" />
      <Stack key={user ? 'app' : 'auth'} screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        ) : (
          <Stack.Screen name="(app)" options={{ animation: 'none' }} />
        )}
      </Stack>
    </ThemeProvider>
  );
}

export default function App() {
  useWebAutoUpdate();
  useWebImageGuard();
  useIosNoInputZoom();

  return (
    <AuthProvider>
      <RouteLinkPreview />
      <ToastProvider>
        <ConfirmProvider>
          <View style={frameStyles.outer}>
            <View style={frameStyles.inner}>
              <RootLayout />
              <OfflineBanner />
            </View>
          </View>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

// 예상하지 못한 오류로 화면이 깨지면 흰 화면 대신 다시 시도할 수 있는 안내를 보여준다
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  console.error('화면 오류:', error);
  return (
    <View style={errorStyles.wrap}>
      <Text style={errorStyles.icon}>😥</Text>
      <Text style={errorStyles.title}>문제가 생겼어요</Text>
      <Text style={errorStyles.sub}>잠시 후 다시 시도해주세요. 계속되면 채팅 › 운영자에게 문의해주세요.</Text>
      <TouchableOpacity style={errorStyles.btn} onPress={retry}>
        <Text style={errorStyles.btnText}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  icon: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: '700', color: '#222', marginTop: 16 },
  sub: { fontSize: 14, color: '#777', textAlign: 'center', marginTop: 8, lineHeight: 21 },
  btn: { marginTop: 24, backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

const frameStyles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: WIDE_BACKDROP },
  inner: { flex: 1, width: '100%', maxWidth: APP_MAX_WIDTH, alignSelf: 'center', backgroundColor: '#fff', overflow: 'hidden' },
});
