import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

// 웹 페이지의 기본 HTML (한국어 서비스이므로 lang="ko").
// 링크 미리보기용 태그(og:*)는 _layout.tsx와 각 화면의 <Head>에서 넣는다.
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
      </head>
      <body>{children}</body>
    </html>
  );
}
