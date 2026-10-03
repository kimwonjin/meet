import { useEffect } from 'react';
import { Platform } from 'react-native';

const ENTRY_PATTERN = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

// 웹 배포본에서만 동작: 탭/창으로 돌아왔을 때 새 버전이 배포되어 있으면 자동으로 새로고침한다.
// (열려 있던 탭이 예전 코드로 계속 동작하는 문제 방지)
export function useWebAutoUpdate() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const current = document.querySelector('script[src*="/_expo/static/js/web/entry-"]')?.getAttribute('src')?.match(ENTRY_PATTERN)?.[0];
    if (!current) return; // 개발 서버 등 번들 이름이 없는 환경

    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const html = await (await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })).text();
        const latest = html.match(ENTRY_PATTERN)?.[0];
        if (latest && latest !== current) window.location.reload();
      } catch {
        // 네트워크 오류는 다음 확인 때 다시 시도
      } finally {
        checking = false;
      }
    }

    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
}
