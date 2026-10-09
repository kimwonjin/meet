import { supabase } from './supabase';

export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  route?: string;
  routeParams?: Record<string, any>;
}) {
  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body || null,
    deep_link_route: params.route || null,
    deep_link_params: params.routeParams || null,
  });
  if (error) console.error('createNotification error:', error);
}

export async function fetchNotifications(userId: string) {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}

export async function markAllRead(userId: string) {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
}

export async function markOneRead(id: string) {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function getUnreadNotificationCount(userId: string) {
  const { data, error } = await supabase.rpc('fn_get_unread_notification_count', { p_user_id: userId });
  if (error) return 0;
  return (data as number) || 0;
}

// 알림을 눌렀을 때: 읽음 처리하고 알림이 가리키는 화면으로 간다 (알림 센터 · 홈 '최근 소식' 공용)
export async function openNotification(router: { push: (href: any) => void }, n: any) {
  if (!n.read_at) await markOneRead(n.id);
  if (n.deep_link_route) {
    // 매칭 관련 알림은 매칭 탭의 '매칭내역'으로 연다
    const params = { ...(n.deep_link_params || {}), ...(n.deep_link_route === '/matching' ? { view: 'history' } : {}) };
    router.push({ pathname: n.deep_link_route, params });
  }
}

// '5분 전', '어제' 같은 짧은 시간 표시
export function timeAgo(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d === 1) return '어제';
  if (d < 7) return `${d}일 전`;
  const dt = new Date(iso);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일`;
}
