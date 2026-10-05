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
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
