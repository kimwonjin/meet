import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Platform } from 'react-native';

const PENDING_KEY = 'pendingInvite';
// 앱(폰)에서 만든 링크도 웹 주소로 보낸다 — 받는 사람이 앱이 없어도 열 수 있게
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || 'https://meet-six-psi.vercel.app';

export function inviteUrl(connectorId: string) {
  const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : WEB_URL;
  return `${base}/invite?p=${connectorId}`;
}

export function inviteMessage(partnerName: string, connectorId: string, url?: string) {
  return `${partnerName} 파트너가 두두인연에 초대했어요.\n아래 링크로 가입하면 저에게 바로 연결돼요.\n${url ?? inviteUrl(connectorId)}`;
}

// 초대 링크로 들어왔다가 가입·로그인하는 동안 기억해 둔다 (30일)
// intent: 'signup' = '가입하고 연결하기'로 들어옴 → 가입을 마치면 가입 신청을 자동으로 보낸다
export type PendingInvite = { id: string; code?: string | null; intent?: 'signup' | 'login'; at: number };
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'dd_invite';

export async function savePendingInvite(connectorId: string, code?: string | null, intent?: 'signup' | 'login') {
  const v: PendingInvite = { id: connectorId, code: code ?? null, intent, at: Date.now() };
  try { await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch {}
  // 웹은 쿠키에도 남긴다 (저장소가 지워지는 브라우저 대비)
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    try { document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(v))}; max-age=${INVITE_TTL_MS / 1000}; path=/; samesite=lax`; } catch {}
  }
}

function readCookie(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  try {
    const m = document.cookie.split('; ').find((c) => c.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  } catch {
    return null;
  }
}

function parsePending(raw: string | null): PendingInvite | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.id === 'string') return Date.now() - (v.at || 0) > INVITE_TTL_MS ? null : v;
  } catch {}
  // 예전 형식: 파트너 ID 문자열만 저장
  return /^[0-9a-f-]{36}$/i.test(raw) ? { id: raw, at: Date.now() } : null;
}

export async function takePendingInvite(): Promise<PendingInvite | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_KEY);
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {}
  const cookie = readCookie();
  if (cookie && Platform.OS === 'web' && typeof document !== 'undefined') {
    try { document.cookie = `${COOKIE}=; max-age=0; path=/`; } catch {}
  }
  return parsePending(raw) ?? parsePending(cookie);
}

// 이번 실행에서 막 가입했는지 (가입 수를 셀 때 기존 회원 로그인과 구분)
let justSignedUp = false;
export function markJustSignedUp() { justSignedUp = true; }
export function consumeJustSignedUp() { const v = justSignedUp; justSignedUp = false; return v; }

// ───── 코드 링크 (/c/코드) ─────
export const INVITE_CODE_RE = /^[A-Za-z0-9]{8}$/;

export function codeUrl(code: string) {
  const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : WEB_URL;
  return `${base}/c/${code}`;
}

// 내 초대 코드 (DB 준비 전이면 null → 예전 /invite?p= 링크를 쓴다)
export async function getInviteCode(connectorId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('fn_get_or_create_invite_code', { p_connector_id: connectorId });
  return !error && typeof data === 'string' && INVITE_CODE_RE.test(data) ? data : null;
}

// 코드 → 파트너. 없는 코드면 null, 꺼진 링크면 active=false
export async function resolveInviteCode(code: string): Promise<{ connectorId: string; active: boolean; code: string } | null> {
  if (!INVITE_CODE_RE.test(code)) return null;
  const upper = code.toUpperCase();
  const { data, error } = await supabase.from('invite_links').select('connector_id, is_active').eq('code', upper).maybeSingle();
  if (error || !data) return null;
  return { connectorId: data.connector_id, active: !!data.is_active, code: upper };
}

// 검색엔진·링크 미리보기 봇은 열람 수에서 뺀다 (카카오톡 앱 안 브라우저는 사람이므로 'kakaotalk-scrap'만 거른다)
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|daumoa|yeti|preview|headless|lighthouse|python|curl|wget|axios|node-fetch/i;
export function isBot(ua?: string) {
  // 앱(폰)에서 연 경우는 사람
  if (ua === undefined && Platform.OS !== 'web') return false;
  const agent = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
  return !agent || BOT_RE.test(agent);
}

// 같은 방문(탭)에서 여러 번 열어도 열람 1번으로 센다
let memSession: string | null = null;
function sessionId() {
  try {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      let v = sessionStorage.getItem('dd_sid');
      if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('dd_sid', v); }
      return v;
    }
  } catch {}
  return (memSession ||= Math.random().toString(36).slice(2) + Date.now().toString(36));
}

export async function trackInvite(code: string, event: 'CLICK' | 'SIGNUP', userId?: string) {
  if (event === 'CLICK' && isBot()) return;
  try {
    await supabase.rpc('fn_track_invite', { p_code: code, p_event: event, p_session_id: userId ? null : sessionId(), p_user_id: userId ?? null });
  } catch {}
}

export type InviteStats = {
  totals: { CLICK: number; SIGNUP: number; APPLIED: number; APPROVED: number };
  daily: { d: string; CLICK: number; APPLIED: number }[];
};

export async function fetchInviteStats(connectorId: string): Promise<InviteStats | null> {
  const { data, error } = await supabase.rpc('fn_invite_stats', { p_connector_id: connectorId });
  if (error || !data?.totals) return null;
  return data as InviteStats;
}

export type ShareTemplate = { id: string; title: string; body: string };

// 운영자가 관리하는 공유 문구 (없거나 오류면 빈 목록 → 화면에서 숨김)
export async function fetchShareTemplates(): Promise<ShareTemplate[]> {
  const { data, error } = await supabase.from('share_templates').select('id, title, body').eq('is_active', true).order('sort_order');
  if (error || !data) return [];
  return data as ShareTemplate[];
}

// {link} 자리에 링크를 넣는다. 자리가 없으면 끝에 붙인다.
export function fillTemplate(body: string, link: string) {
  return body.includes('{link}') ? body.split('{link}').join(link) : `${body}\n${link}`;
}
