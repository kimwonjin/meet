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
