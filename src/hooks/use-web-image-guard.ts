import { useEffect } from 'react';
import { Platform } from 'react-native';

// 웹: 사진을 우클릭·길게 눌러 저장하거나 끌어서 가져가지 못하게 한다.
// (폰 캡처 버튼은 웹에서 막을 수 없으므로 사진의 워터마크가 실제 보호 장치다)
export function useWebImageGuard() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = 'img{-webkit-touch-callout:none;-webkit-user-drag:none;user-select:none;-webkit-user-select:none;}';
    document.head.appendChild(style);
    const isImage = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'IMG' || !!t.closest('[data-protected-photo]'));
    const block = (e: Event) => { if (isImage(e.target)) e.preventDefault(); };
    document.addEventListener('contextmenu', block);
    document.addEventListener('dragstart', block);
    return () => {
      style.remove();
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('dragstart', block);
    };
  }, []);
}
