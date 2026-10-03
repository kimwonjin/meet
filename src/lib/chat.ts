import { supabase } from './supabase';
import { createNotification } from './notifications';

export async function getOrCreateThread(userA: string, userB: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('fn_get_or_create_thread', { p_user_a: userA, p_user_b: userB });
  if (error) {
    console.error('getOrCreateThread error:', error);
    return null;
  }
  return data as string;
}

export async function fetchThreads(myId: string) {
  const { data: threads } = await supabase
    .from('chat_threads')
    .select('*')
    .or(`participant_1_id.eq.${myId},participant_2_id.eq.${myId}`)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (!threads || threads.length === 0) return [];

  const otherIds = threads.map((t: any) => (t.participant_1_id === myId ? t.participant_2_id : t.participant_1_id));
  const { data: users } = await supabase.from('users').select('id, name, role').in('id', otherIds);

  const threadIds = threads.map((t: any) => t.id);
  const { data: incomingMessages } = await supabase
    .from('chat_messages')
    .select('thread_id, created_at')
    .in('thread_id', threadIds)
    .neq('sender_id', myId);

  return threads.map((t: any) => {
    const isP1 = t.participant_1_id === myId;
    const otherId = isP1 ? t.participant_2_id : t.participant_1_id;
    const other = (users || []).find((u: any) => u.id === otherId);
    const myLastRead = isP1 ? t.p1_last_read_at : t.p2_last_read_at;
    const unreadCount = (incomingMessages || []).filter(
      (m: any) => m.thread_id === t.id && (!myLastRead || new Date(m.created_at) > new Date(myLastRead))
    ).length;

    return {
      id: t.id,
      otherId,
      otherName: other?.name || '사용자',
      otherRole: other?.role || 'hopeful',
      lastMessageAt: t.last_message_at,
      lastMessagePreview: t.last_message_preview,
      unreadCount,
    };
  });
}

export async function fetchMessages(threadId: string) {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function sendMessage(threadId: string, senderId: string, content: string) {
  const { count: existingCount } = await supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('thread_id', threadId);

  const { error } = await supabase.from('chat_messages').insert({ thread_id: threadId, sender_id: senderId, content });

  // 알림센터에는 "새 대화의 시작"만 남긴다 (메시지마다 쌓지 않음)
  if (!error && existingCount === 0) {
    const { data: thread } = await supabase.from('chat_threads').select('*').eq('id', threadId).single();
    if (thread) {
      const recipientId = thread.participant_1_id === senderId ? thread.participant_2_id : thread.participant_1_id;
      const { data: sender } = await supabase.from('users').select('name').eq('id', senderId).single();
      await createNotification({
        userId: recipientId,
        type: 'chat_started',
        title: '새로운 대화가 시작되었습니다',
        body: `${sender?.name || '상대방'}님이 메시지를 보냈습니다`,
        route: '/chat',
      });
    }
  }

  return { error };
}

export async function markThreadRead(threadId: string, myId: string) {
  const { data: thread } = await supabase.from('chat_threads').select('*').eq('id', threadId).single();
  if (!thread) return;
  const field = thread.participant_1_id === myId ? 'p1_last_read_at' : 'p2_last_read_at';
  await supabase.from('chat_threads').update({ [field]: new Date().toISOString() }).eq('id', threadId);
}

export async function getUnreadCount(myId: string) {
  const { data, error } = await supabase.rpc('fn_get_unread_message_count', { p_user_id: myId });
  if (error) return 0;
  return (data as number) || 0;
}

export async function findOperator() {
  const { data } = await supabase.from('users').select('id, name').eq('role', 'operator').limit(1).maybeSingle();
  return data;
}
