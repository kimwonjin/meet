// 휴대폰 알림(웹 푸시)
// GET  /api/push        → 브라우저가 알림을 구독할 때 쓰는 공개키 { publicKey }
// POST /api/push {id}              → 알림(notifications) 한 건을 받는 사람의 기기들로 보낸다
// POST /api/push {id, kind:'chat'} → 채팅 메시지 한 건을 받는 사람에게 보낸다 (이미 대화방을 보고 있으면 보내지 않음)
// DB에 알림·메시지가 저장되면 DB가 자동으로 이 주소를 부른다 (add_web_push.sql)
// 같은 건은 한 번만 보내고(pushed_at), 10분이 지난 건은 보내지 않는다
import { generateVapidKeys, sendPush } from './_lib/webpush.js';

export const config = { runtime: 'edge' };

function env() {
  return {
    url: (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
  };
}

async function rest(path, init = {}, fetchImpl = fetch) {
  const { url, key } = env();
  return fetchImpl(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// 서명 키: 처음 한 번 만들어 DB에 저장하고 이후로는 같은 키를 쓴다 (키가 바뀌면 기존 구독이 모두 끊기므로)
export async function loadKeys(fetchImpl = fetch) {
  const read = async () => {
    const res = await rest('push_keys?select=public_key,private_jwk&id=eq.1', {}, fetchImpl);
    if (!res.ok) throw new Error('push_keys 표가 없어요 (add_web_push.sql 실행 전)');
    const rows = await res.json();
    return rows[0] ? { publicKey: rows[0].public_key, privateJwk: rows[0].private_jwk } : null;
  };
  const found = await read();
  if (found) return found;
  const k = await generateVapidKeys();
  // 동시에 두 번 만들어도 먼저 저장된 것 하나만 남는다
  await rest('push_keys', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, public_key: k.publicKey, private_jwk: k.privateJwk }) }, fetchImpl);
  return read();
}

// 알림을 눌렀을 때 열 주소 (앱 안 알림을 눌렀을 때와 같은 화면)
export function targetUrl(n) {
  const route = n.deep_link_route || '/home';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(n.deep_link_params || {})) if (v !== null && v !== undefined) params.set(k, String(v));
  if (route === '/matching' && !params.has('view')) params.set('view', 'history');
  params.set('push', n.id); // 열리면 앱이 이 알림을 읽음으로 바꾼다
  return `${route}?${params.toString()}`;
}

async function sendToUser(userId, payload, origin, fetchImpl) {
  const subsRes = await rest(`push_subscriptions?select=endpoint,p256dh,auth&user_id=eq.${encodeURIComponent(userId)}`, {}, fetchImpl);
  const subs = subsRes.ok ? await subsRes.json() : [];
  if (!subs.length) return { sent: 0, reason: 'no_device' };
  const keys = await loadKeys(fetchImpl);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await sendPush(s, payload, keys, origin, fetchImpl);
      if (r.status >= 200 && r.status < 300) sent++;
      // 앱을 지웠거나 알림을 끈 기기는 목록에서 뺀다
      if (r.gone) await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }, fetchImpl);
    } catch {
      // 한 기기 실패가 다른 기기 발송을 막지 않게
    }
  }));
  return { sent, devices: subs.length };
}

const sinceIso = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

export async function pushNotification(id, origin, fetchImpl = fetch) {
  // 아직 보내지 않은 최근 알림만 '보냄'으로 바꾸면서 가져온다 (두 번 불려도 한 번만 보낸다)
  const claim = await rest(
    `notifications?id=eq.${encodeURIComponent(id)}&pushed_at=is.null&created_at=gt.${encodeURIComponent(sinceIso())}&select=id,user_id,type,title,body,deep_link_route,deep_link_params`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ pushed_at: new Date().toISOString() }) },
    fetchImpl,
  );
  if (!claim.ok) return { sent: 0, reason: 'claim_failed' };
  const n = (await claim.json())[0];
  if (!n) return { sent: 0, reason: 'already_sent_or_old' };
  // 새 대화 알림은 채팅 메시지 알림으로 이미 가므로 두 번 보내지 않는다
  if (n.type === 'chat_started') return { sent: 0, reason: 'chat' };
  return sendToUser(n.user_id, { title: n.title, body: n.body || '', url: targetUrl(n), tag: n.id }, origin, fetchImpl);
}

// 채팅 메시지: 받는 사람이 대화방을 열어 두고 있으면 몇 초 안에 읽음 처리되므로(실시간 연결이 끊겨도 5초마다 확인), 7초 기다렸다가 아직 안 읽었을 때만 보낸다
export async function pushChat(id, origin, fetchImpl = fetch, waitMs = 7000) {
  const claim = await rest(
    `chat_messages?id=eq.${encodeURIComponent(id)}&pushed_at=is.null&created_at=gt.${encodeURIComponent(sinceIso())}&select=id,thread_id,sender_id,content,created_at`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ pushed_at: new Date().toISOString() }) },
    fetchImpl,
  );
  if (!claim.ok) return { sent: 0, reason: 'claim_failed' };
  const m = (await claim.json())[0];
  if (!m) return { sent: 0, reason: 'already_sent_or_old' };
  if (waitMs) await new Promise((r) => setTimeout(r, waitMs));

  const tRes = await rest(`chat_threads?select=participant_1_id,participant_2_id,p1_last_read_at,p2_last_read_at&id=eq.${encodeURIComponent(m.thread_id)}`, {}, fetchImpl);
  const t = tRes.ok ? (await tRes.json())[0] : null;
  if (!t) return { sent: 0, reason: 'no_thread' };
  const toFirst = t.participant_2_id === m.sender_id;
  const recipient = toFirst ? t.participant_1_id : t.participant_2_id;
  const readAt = toFirst ? t.p1_last_read_at : t.p2_last_read_at;
  if (readAt && new Date(readAt).getTime() >= new Date(m.created_at).getTime()) return { sent: 0, reason: 'read' };

  const uRes = await rest(`users?select=id,name,withdrawn_at&id=in.(${encodeURIComponent(m.sender_id)},${encodeURIComponent(recipient)})`, {}, fetchImpl);
  const users = uRes.ok ? await uRes.json() : [];
  const sender = users.find((u) => u.id === m.sender_id);
  if (users.find((u) => u.id === recipient)?.withdrawn_at) return { sent: 0, reason: 'withdrawn' };
  const name = sender?.name || '상대방';
  // 채팅 사진은 주소 대신 '사진을 보냈어요'로
  const raw = String(m.content || '');
  const text = raw.startsWith('📷 사진\n') ? '📷 사진을 보냈어요' : raw;
  const params = new URLSearchParams({ with: m.sender_id, name });
  return sendToUser(recipient, {
    title: `${name}님의 메시지`,
    body: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    url: `/chat?${params.toString()}`,
    tag: `chat-${m.thread_id}`, // 같은 대화방 알림은 하나로 묶인다
  }, origin, fetchImpl);
}

export default async function handler(req) {
  const origin = new URL(req.url).origin;
  try {
    if (req.method === 'GET') {
      const keys = await loadKeys();
      return json({ publicKey: keys.publicKey });
    }
    if (req.method === 'POST') {
      const { id, kind } = await req.json().catch(() => ({}));
      if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return json({ error: 'bad id' }, 400);
      return json(kind === 'chat' ? await pushChat(String(id), origin) : await pushNotification(String(id), origin));
    }
    return json({ error: 'method' }, 405);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 503);
  }
}
