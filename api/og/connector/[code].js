// 파트너별 링크 미리보기 이미지 (1200×630). /api/og/connector/코드?v=버전
// 국내결혼중개업 신고번호가 없거나, 없는/꺼진 링크면 404 (광고 노출 방지).
import { ImageResponse } from '@vercel/og';
import { loadPartner, reportNumber } from '../../_lib/preview.js';

export const config = { runtime: 'edge' };

const ACCENT = '#5B21FF';

// 한글 글꼴: 이미지에 쓰는 글자만 담은 작은 글꼴을 Google Fonts에서 받아 온다
async function font(text, weight) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`, {
    // 최신 브라우저로 보이면 woff2를 주는데, 이미지 그리기에는 ttf가 필요하다
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })).text();
  const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!src) throw new Error('font');
  return (await fetch(src[1])).arrayBuffer();
}

const h = (type, style, children) => ({ type, props: { style, children } });

export function card(p) {
  const facts = [p.regions.length ? `${p.regions.slice(0, 3).join('·')}` : '', p.fee ? `1회 ${p.fee.toLocaleString('ko-KR')}원` : ''].filter(Boolean);
  return h('div', { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F7F4FF', padding: '64px 72px', fontFamily: 'Noto Sans KR' }, [
    h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
      h('div', { width: 56, height: 56, borderRadius: 16, background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700 }, '두'),
      h('div', { fontSize: 32, fontWeight: 700, color: ACCENT }, '두두인연'),
    ]),
    h('div', { display: 'flex', flexDirection: 'column', gap: 18 }, [
      h('div', { fontSize: 64, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2, display: 'flex' }, `${p.title.slice(0, 16)}`),
      h('div', { fontSize: 34, color: '#444', display: 'flex' }, `${p.name ? p.name + ' 파트너' : '파트너'}${p.verified ? ' · ✓ 인증' : ''}`),
      p.career ? h('div', { fontSize: 30, color: '#666', display: 'flex' }, p.career.slice(0, 34)) : null,
      facts.length ? h('div', { display: 'flex', gap: 12 }, facts.map((f) => h('div', { fontSize: 28, color: '#333', background: '#fff', borderRadius: 999, padding: '8px 22px', display: 'flex' }, f))) : null,
    ].filter(Boolean)),
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      h('div', { fontSize: 30, color: '#555', display: 'flex' }, '가입하면 이 파트너에게 바로 연결돼요'),
      h('div', { fontSize: 30, fontWeight: 700, color: '#fff', background: ACCENT, borderRadius: 18, padding: '14px 30px', display: 'flex' }, '초대장 열기'),
    ]),
  ]);
}

export function cardText(p) {
  return `두두인연가입하면이파트너에게바로연결돼요초대장열기파트너인증·✓1회원0123456789,${p.title}${p.name}${p.career}${p.regions.join('')}`;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const code = (url.pathname.split('/').pop() || '').toUpperCase();
  try {
    if (!(await reportNumber())) return new Response('Not found', { status: 404 });
    const p = await loadPartner(code);
    if (!p) return new Response('Not found', { status: 404 });
    return await render(p);
  } catch (e) {
    if (process.env.OG_DEBUG) console.error(e);
    return new Response('Not found', { status: 404 });
  }
}

async function render(p) {
  try {
    const text = cardText(p);
    const [regular, bold] = await Promise.all([font(text, 400), font(text, 700)]);
    return new ImageResponse(card(p), {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Noto Sans KR', data: regular, weight: 400, style: 'normal' },
        { name: 'Noto Sans KR', data: bold, weight: 700, style: 'normal' },
      ],
      headers: { 'cache-control': 'public, max-age=86400, immutable' },
    });
  } catch (e) {
    // 글꼴을 못 받는 등 그리기에 실패하면 기본 초대 이미지를 준다
    if (process.env.OG_DEBUG) console.error(e);
    const base = (process.env.EXPO_PUBLIC_WEB_URL || 'https://meet-six-psi.vercel.app').replace(/\/$/, '');
    return Response.redirect(`${base}/og-invite.png`, 302);
  }
}
