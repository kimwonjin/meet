import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

// 웹 페이지의 기본 HTML (한국어 서비스이므로 lang="ko").
// 링크 미리보기용 태그(og:*)는 _layout.tsx와 각 화면의 <Head>에서 넣는다.
const BOOT_CSS = `#boot{position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",Roboto,sans-serif;transition:opacity .2s}
#boot .t{font-size:28px;font-weight:800;color:#5B21FF;letter-spacing:-0.5px}
#boot .s{font-size:14px;color:#87848D}
#boot .d{width:28px;height:28px;border-radius:50%;border:3px solid #EDE4FF;border-top-color:#5B21FF;animation:bootspin .8s linear infinite}
@keyframes bootspin{to{transform:rotate(360deg)}}`;
const BOOT_HTML = '<div class="t">두두인연</div><div class="d"></div><div class="s">믿을 수 있는 소개를 준비하고 있어요</div>';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#5B21FF" />
        {/* 홈 화면에 추가(앱처럼 설치)와 휴대폰 알림에 필요 */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="두두인연" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
      </head>
      <body>
        {children}
        {/* 앱 파일을 받는 동안 바로 보이는 가벼운 로딩 화면 (앱이 뜨면 _layout.tsx에서 지운다) */}
        <div id="boot" dangerouslySetInnerHTML={{ __html: BOOT_HTML }} />
      </body>
    </html>
  );
}
