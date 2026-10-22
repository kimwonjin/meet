// 휴대폰 알림(웹 푸시) 켜기·끄기
// - 아이폰은 '홈 화면에 추가'한 앱에서만 알림을 받을 수 있다 (사파리 탭에서는 불가)
// - 카카오톡 등 앱 안 브라우저에서는 알림을 받을 수 없다 → 다른 브라우저로 열도록 안내
// - 서버 준비(add_web_push.sql) 전이면 'unavailable' → 화면에서 알림 안내를 숨긴다
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type PushState = 'unavailable' | 'unsupported' | 'inapp' | 'needs-install' | 'denied' | 'off' | 'on';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';
const ua = () => (isWeb ? navigator.userAgent : '');

export const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (isWeb && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isKakao = () => /KAKAOTALK/i.test(ua());
const isInApp = () => /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(ua());
export const isStandalone = () =>
  isWeb && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true);
const supported = () => isWeb && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 서버 공개키 (한 번 받아 두면 다시 묻지 않는다). 버튼을 누르기 전에 미리 받아 둬야 아이폰이 권한 창을 띄워 준다
let publicKey: string | null = null;
let keyPromise: Promise<string | null> | null = null;
function loadPublicKey() {
  if (publicKey) return Promise.resolve(publicKey);
  if (!keyPromise) {
    keyPromise = fetch('/api/push', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (publicKey = d?.publicKey || null))
      .catch(() => null)
      .finally(() => { if (!publicKey) keyPromise = null; });
  }
  return keyPromise;
}

async function registration() {
  if (!supported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js'));
  } catch {
    return null;
  }
}

// 앱이 열릴 때 서비스 워커를 등록해 둔다 (홈 화면 설치·알림 누르기 처리)
export function registerServiceWorker() {
  if (supported()) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

async function save(userId: string, sub: PushSubscription) {
  const j = sub.toJSON() as any;
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, user_id: userId, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: ua().slice(0, 200), updated_at: new Date().toISOString() },
    { onConflict: 'endpoint' },
  );
  return !error;
}

export async function getPushState(): Promise<PushState> {
  if (!isWeb) return 'unsupported';
  if (isInApp()) return 'inapp';
  if (isIOS() && !isStandalone()) return (await loadPublicKey()) ? 'needs-install' : 'unavailable';
  if (!supported()) return 'unsupported';
  if (!(await loadPublicKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

// '알림 켜기' 버튼에서 부른다. 권한 창은 버튼을 누른 직후 바로 띄워야 한다 (그 전에 다른 기다림 없이)
export async function enablePush(userId: string): Promise<'on' | 'denied' | 'error'> {
  if (!supported()) return 'error';
  const perm = await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'error';
  try {
    const key = await loadPublicKey();
    const reg = await registration();
    if (!key || !reg) return 'error';
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
    return (await save(userId, sub)) ? 'on' : 'error';
  } catch {
    return 'error';
  }
}

// 이 기기에서 알림 끄기
export async function disablePush() {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

// 로그인할 때: 이 기기에서 알림을 켜 둔 상태면 지금 로그인한 계정으로 연결한다
// (같은 기기에서 다른 계정으로 바꿔 로그인한 경우, 서버 서명 키가 바뀐 경우도 여기서 맞춘다)
export async function syncPush(userId: string) {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const key = await loadPublicKey();
    const reg = await registration();
    if (!key || !reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options.applicationServerKey, keyBytes(key))) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await save(userId, sub);
  } catch {
    // 알림 연결에 실패해도 앱 사용에는 지장 없음
  }
}

// 로그아웃할 때: 이 기기로 이전 계정의 알림이 오지 않게 연결만 끊는다 (권한은 그대로 두어 다음 로그인 때 다시 연결)
export async function detachPush() {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch {
    // 무시
  }
}

// 카카오톡 안에서 열린 경우: 기본 브라우저로 다시 열기
export function openInExternalBrowser() {
  if (!isWeb) return false;
  if (isKakao()) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`;
    return true;
  }
  return false;
}
