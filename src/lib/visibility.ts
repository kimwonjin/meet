import { AppState, Platform } from 'react-native';

// 앱(브라우저 탭)이 뒤에 숨어 있으면 주기적인 서버 조회를 건너뛴다 (서버 요청·로그 줄이기)
export function isAppHidden() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') return document.visibilityState === 'hidden';
  return AppState.currentState !== 'active';
}
