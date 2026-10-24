// 앱 안 '의견 보내기': 문제나 의견을 운영자에게 보낸다
// 어느 화면을 보다가 보냈는지는 앱이 기억해 함께 보낸다 (마이 탭을 열기 직전 화면)
// SQL(add_feedback.sql) 실행 전에는 available=false → 메뉴를 숨긴다
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { createNotification } from './notifications';

let lastScreen = '/home';
export function setLastScreen(path: string) {
  if (path && path !== '/profile') lastScreen = path;
}
export function getLastScreen() {
  return lastScreen;
}

const SCREEN_NAMES: Record<string, string> = {
  '/home': '홈', '/connectors': '회원·파트너', '/matching': '매칭', '/chat': '채팅', '/profile': '마이',
  '/dashboard': '현황', '/settlements': '정산관리', '/alliances': '동맹', withdraw: '탈퇴',
};
export const screenName = (path?: string | null) => (path ? SCREEN_NAMES[path] || path : '-');

export async function feedbackAvailable() {
  const { error } = await supabase.from('feedback').select('id').limit(1);
  return !error;
}

export async function sendFeedback(user: { id: string; name: string; role: string }, message: string, photoUrl: string | null) {
  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    role: user.role,
    screen: getLastScreen(),
    message: message.trim().slice(0, 2000),
    photo_url: photoUrl,
    user_agent: Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : Platform.OS,
    app_version: process.env.EXPO_PUBLIC_BUILD_ID?.slice(0, 7) || null,
  });
  if (error) return false;
  // 운영자에게 알림 (실패해도 의견은 저장됨)
  const { data: ops } = await supabase.from('users').select('id').eq('role', 'operator');
  await Promise.all(((ops || []) as any[]).filter((o) => o.id !== user.id).map((o) => createNotification({
    userId: o.id,
    type: 'feedback_received',
    title: '새 의견이 도착했어요',
    body: `${user.name}님 · ${screenName(getLastScreen())} 화면 · ${message.trim().slice(0, 40)}`,
    route: '/dashboard',
  }).catch(() => {})));
  return true;
}

export async function fetchFeedback(limit = 30) {
  const { data, error } = await supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) return null;
  const rows = (data || []) as any[];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const { data: users } = ids.length ? await supabase.from('users').select('id, name').in('id', ids) : { data: [] as any[] };
  const names = new Map(((users || []) as any[]).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, userName: names.get(r.user_id) || '알 수 없음' }));
}

export async function setFeedbackDone(id: string, done: boolean) {
  const { error } = await supabase.from('feedback').update({ status: done ? 'done' : 'open' }).eq('id', id);
  return !error;
}

// 탈퇴 이유 (선택). 의견 표에 '탈퇴' 화면으로 남긴다 (운영자 현황 '받은 의견'에서 모아 봄). 실패해도 탈퇴는 그대로
export const WITHDRAW_REASONS = ['좋은 인연을 만났어요', '소개가 잘 오지 않아요', '맞는 분이 없었어요', '비용이 부담돼요', '사용하기 불편해요', '잠시 쉬고 싶어요', '기타'];
export async function saveWithdrawReason(user: { id: string; role: string }, reasons: string[], memo: string) {
  if (!reasons.length && !memo.trim()) return;
  const message = `[탈퇴] ${reasons.join(', ') || '이유 없음'}${memo.trim() ? ` · ${memo.trim().slice(0, 300)}` : ''}`;
  await supabase.from('feedback').insert({ user_id: user.id, role: user.role, screen: 'withdraw', message }).then(() => {}, () => {});
}
