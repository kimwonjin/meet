// /c/코드 로 들어오면 (vercel.json rewrites) 웹 페이지 파일에 파트너별 미리보기 태그를 넣어 돌려준다.
// 카카오톡·문자 미리보기가 '○○ 파트너의 초대장'으로 보이게 하기 위함.
// 신고번호가 없거나 링크가 꺼졌으면 기본 미리보기 그대로 (파트너 정보 없음). 어떤 오류가 나도 페이지는 열린다.
import { describe, injectMeta, loadPartner, reportNumber, versionOf } from './_lib/preview.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') || url.pathname.split('/').pop() || '').toUpperCase();
  // 앱 화면 파일(/c/[code])을 받아 온다. 혹시 못 받으면 첫 화면 파일을 쓴다 (주소에 맞는 화면은 앱이 다시 그린다)
  let pageRes = code === '[CODE]' ? null : await fetch(new URL('/c/[code]', url.origin)).catch(() => null);
  if (!pageRes || !pageRes.ok) pageRes = await fetch(new URL('/', url.origin));
  let html = await pageRes.text();
  try {
    if (await reportNumber()) {
      const p = await loadPartner(code);
      if (p) {
        html = injectMeta(html, {
          title: `${p.title} 파트너의 두두인연 초대장`,
          description: describe(p),
          image: `${url.origin}/api/og/connector/${code}?v=${versionOf(p)}`,
        });
      }
    }
  } catch {
    // 미리보기를 못 만들어도 페이지는 그대로 연다
  }
  return new Response(html, {
    status: pageRes.ok ? 200 : pageRes.status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=300' },
  });
}
