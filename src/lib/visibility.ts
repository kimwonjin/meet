import { AppState, Platform } from 'react-native';

// 앱(브라우저 탭)이 뒤에 숨어 있으면 주기적인 서버 조회를 건너뛴다 (서버 요청·로그 줄이기)
export function isAppHidden() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') return document.visibilityState === 'hidden';
  return AppState.currentState !== 'active';
}

// 앱이 다시 보이게 되면 실행할 함수를 등록한다 (웹: 탭 전환, 앱: 백그라운드 → 앞으로). 해제 함수를 돌려준다
export function onAppVisible(fn: () => void) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const h = () => { if (document.visibilityState === 'visible') fn(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') fn(); });
  return () => sub.remove();
}
