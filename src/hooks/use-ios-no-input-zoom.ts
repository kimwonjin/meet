import { useEffect } from 'react';
import { Platform } from 'react-native';

// 아이폰 사파리는 글자 크기 16px 미만인 입력칸을 누르면 화면을 자동으로 확대하고, 다른 화면으로 가도 확대된 채로 남는다
// (화면이 옆으로 넘쳐 탭바 '마이'가 잘려 보이는 원인). 아이폰에서만 자동 확대를 끈다.
// 아이폰은 maximum-scale 이 있어도 두 손가락 확대는 계속 허용하므로 접근성은 유지된다. 안드로이드는 건드리지 않는다.
export function isIosWeb(ua: string, maxTouchPoints = 0) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function useIosNoInputZoom() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (!isIosWeb(navigator.userAgent, navigator.maxTouchPoints)) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const content = meta.getAttribute('content') || '';
    if (!/maximum-scale/.test(content)) meta.setAttribute('content', `${content}, maximum-scale=1`);
  }, []);
}
