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

export function inviteMessage(partnerName: string, connectorId: string) {
  return `${partnerName} 파트너가 두두인연에 초대했어요.\n아래 링크로 가입하면 저에게 바로 연결돼요.\n${inviteUrl(connectorId)}`;
}

// 초대 링크로 들어왔다가 가입·로그인하는 동안 기억해 둔다
export async function savePendingInvite(connectorId: string) {
  try { await AsyncStorage.setItem(PENDING_KEY, connectorId); } catch {}
}

export async function takePendingInvite(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(PENDING_KEY);
    if (id) await AsyncStorage.removeItem(PENDING_KEY);
    return id;
  } catch {
    return null;
  }
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
