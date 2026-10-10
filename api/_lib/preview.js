// 초대 링크(/c/코드) 미리보기용 공통 함수 (Vercel 서버 함수에서 사용)
// 공개해도 되는 항목만 읽는다. 국내결혼중개업 신고번호가 없으면 파트너 정보는 쓰지 않는다.

const CODE_RE = /^[A-Za-z0-9]{8}$/;

function env() {
  return {
    url: (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    reportNumber: (process.env.EXPO_PUBLIC_BIZ_REPORT_NUMBER || '').trim(),
  };
}

async function rest(path, fetchImpl = fetch) {
  const { url, key } = env();
  if (!url || !key) return null;
  const res = await fetchImpl(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  return res.json();
}

// 신고번호: 운영자가 앱에 입력한 값 → 없으면 배포 환경변수
export async function reportNumber(fetchImpl = fetch) {
  const rows = await rest('platform_settings?select=business_report_number&id=eq.1', fetchImpl).catch(() => null);
  const v = Array.isArray(rows) && rows[0] ? String(rows[0].business_report_number || '').trim() : '';
  return v || env().reportNumber;
}

// 코드 → 공개 소개에 쓸 파트너 정보. 없는 코드·꺼진 링크·활동하지 않는 파트너면 null
export async function loadPartner(code, fetchImpl = fetch) {
  if (!CODE_RE.test(code || '')) return null;
  const links = await rest(`invite_links?select=connector_id,is_active&code=eq.${code.toUpperCase()}`, fetchImpl);
  const link = Array.isArray(links) ? links[0] : null;
  if (!link || !link.is_active) return null;
  const id = encodeURIComponent(link.connector_id);
  const [conns, users] = await Promise.all([
    rest(`connectors?select=business_name,verified,main_region,fee_per_session,career,intro,service_description,status&id=eq.${id}`, fetchImpl),
    rest(`users?select=name,withdrawn_at,suspended_at&id=eq.${id}`, fetchImpl),
  ]);
  const c = Array.isArray(conns) ? conns[0] : null;
  const u = Array.isArray(users) ? users[0] : null;
  if (!c || !u || c.status !== 'approved' || u.withdrawn_at || u.suspended_at) return null;
  let regions = [];
  try {
    const r = JSON.parse(c.main_region || '[]');
    regions = Array.isArray(r) ? r : [];
  } catch {}
  return {
    title: c.business_name || u.name || '파트너',
    name: u.name || '',
    verified: !!c.verified,
    regions,
    fee: Number(c.fee_per_session) || 0,
    career: c.career || '',
    intro: [c.intro, c.service_description].map((v) => (v || '').trim()).filter(Boolean)[0] || '',
  };
}

// 소개가 바뀌면 미리보기 이미지 주소도 바뀌도록 (?v=)
export function versionOf(p) {
  const s = JSON.stringify(p);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setMeta(html, attr, name, value) {
  const tag = `<meta ${attr}="${name}" content="${escapeHtml(value)}"/>`;
  // 앱이 만든 태그에는 data-rh 같은 다른 속성이 앞에 붙어 있으므로 위치와 상관없이 찾는다 (같은 태그가 여러 개면 모두 바꾼다)
  const re = new RegExp(`<meta[^>]*\\s${attr}="${name.replace(/[:.]/g, (m) => '\\' + m)}"[^>]*>`, 'gi');
  return html.search(re) >= 0 ? html.replace(re, tag) : html.replace(/<\/head>/i, `${tag}</head>`);
}

// 웹 페이지 파일의 제목·미리보기 태그를 파트너 소개로 바꾼다
export function injectMeta(html, { title, description, image }) {
  let out = html;
  out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    : out.replace(/<\/head>/i, `<title>${escapeHtml(title)}</title></head>`);
  out = setMeta(out, 'name', 'description', description);
  out = setMeta(out, 'property', 'og:title', title);
  out = setMeta(out, 'property', 'og:description', description);
  out = setMeta(out, 'property', 'og:image', image);
  out = setMeta(out, 'name', 'twitter:image', image);
  return out;
}

export function describe(p) {
  const bits = [p.career, p.regions.length ? `${p.regions.join('·')} 지역` : '', p.fee ? `1회 ${p.fee.toLocaleString('ko-KR')}원` : ''].filter(Boolean);
  const text = p.intro || bits.join(' · ') || '가입하면 이 파트너에게 바로 연결돼요.';
  return text.length > 80 ? text.slice(0, 79) + '…' : text;
}
