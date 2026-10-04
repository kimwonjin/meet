import React, { useState, useEffect, useCallback, useRef } from 'react';
import SkeletonScreen from '@/components/Skeleton';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useFocusPolling } from '@/hooks/use-focus-polling';
import SafetyActions from '@/components/SafetyActions';
import { getBlockState } from '@/lib/safety';
import { fetchThreads, fetchMessages, sendMessage, markThreadRead, getOrCreateThread, findOperator } from '@/lib/chat';

type Filter = '전체' | '회원' | '파트너' | '운영자';

function roleLabel(otherRole: string) {
  if (otherRole === 'operator') return '운영자';
  if (otherRole === 'connector') return '파트너';
  return '회원';
}

export default function ChatScreen() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ with?: string; name?: string }>();
  const [threads, setThreads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('전체');
  const [operator, setOperator] = useState<{ id: string; name: string } | null>(null);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeOther, setActiveOther] = useState<{ id: string; name: string; withdrawn?: boolean; iBlocked?: boolean; blockedMe?: boolean } | null>(null);
  // 늦게 도착한 이전 대화방의 메시지가 새로 연 대화방에 섞이지 않도록 현재 대화방을 기억한다
  const activeThreadRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const messageListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (user) load();
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
    }, [user])
  );

  useEffect(() => {
    if (user && params.with) {
      openThreadWith(params.with, params.name);
      router.setParams({ with: undefined, name: undefined });
    }
  }, [user, params.with]);

  // 열린 대화방: 새 메시지를 실시간으로 받는다.
  // Realtime이 꺼져 있는 환경에서도 대화가 이어지도록 짧은 주기로 한 번씩 다시 불러온다.
  useEffect(() => {
    if (!activeThreadId || !user) return;
    const threadId = activeThreadId;

    const channel = supabase
      .channel(`chat-thread-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const msg = payload.new as any;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.sender_id !== user.id) markThreadRead(threadId, user.id);
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      const msgs = await fetchMessages(threadId);
      if (activeThreadRef.current !== threadId) return;
      setMessages((prev) => {
        if (msgs.length === prev.length) return prev;
        // 실시간 연결이 없을 때도 열어 둔 대화방의 새 메시지는 읽음 처리한다
        if (msgs.slice(prev.length).some((m: any) => m.sender_id !== user.id)) markThreadRead(threadId, user.id);
        return msgs;
      });
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [activeThreadId, user?.id]);

  // 대화 목록: 화면을 보고 있는 동안 주기적으로 미리보기와 안 읽은 수를 갱신한다
  // (모든 메시지를 실시간으로 받으면 다른 사람 대화까지 받아 매번 다시 불러오게 되므로 쓰지 않는다)
  useFocusPolling(() => load(), 10000, !!user);
  const pullRefresh = usePullRefresh(() => load());

  async function load() {
    if (!user) return;
    const [threadList, op] = await Promise.all([fetchThreads(user.id), findOperator()]);
    setThreads(threadList);
    setOperator(op);
    setLoading(false);
  }

  async function openThreadWith(otherId: string, otherName: string | undefined) {
    if (!user || openingId) return;
    setOpeningId(otherId);
    try {
      const threadId = await getOrCreateThread(user.id, otherId);
      if (!threadId) {
        toast.show('대화방을 열지 못했어요. 잠시 후 다시 시도해주세요', 'error');
        return;
      }
      const known = threads.find((t) => t.otherId === otherId);
      let withdrawn = known?.otherWithdrawn;
      if (withdrawn === undefined) {
        const { data } = await supabase.from('users').select('withdrawn_at').eq('id', otherId).maybeSingle();
        withdrawn = !!data?.withdrawn_at;
      }
      activeThreadRef.current = threadId;
      setActiveThreadId(threadId);
      const block = operator?.id === otherId ? { iBlocked: false, blockedMe: false } : await getBlockState(user.id, otherId);
      setActiveOther({ id: otherId, name: otherName || known?.otherName || operator?.name || '상대방', withdrawn, ...block });
      setMessages([]);
      const msgs = await fetchMessages(threadId);
      if (activeThreadRef.current !== threadId) return;
      setMessages(msgs);
      await markThreadRead(threadId, user.id);
      load();
    } finally {
      setOpeningId(null);
    }
  }

  function closeThread() {
    activeThreadRef.current = null;
    setActiveThreadId(null);
    setActiveOther(null);
    setMessages([]);
    setMessageInput('');
    load();
  }

  async function handleSend() {
    if (!user || !activeThreadId || !messageInput.trim() || sendingRef.current) return;
    const threadId = activeThreadId;
    const content = messageInput.trim();
    sendingRef.current = true;
    setSending(true);
    try {
      const { error } = await sendMessage(threadId, user.id, content);
      if (error) throw error;
      setMessageInput('');
      const msgs = await fetchMessages(threadId);
      if (activeThreadRef.current === threadId) setMessages(msgs);
      setTimeout(() => messageListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      // 보내지 못한 글은 입력창에 그대로 남겨 다시 보낼 수 있게 한다
      console.error('메시지 전송 오류:', error);
      toast.show('메시지를 보내지 못했어요. 다시 시도해주세요', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (loading) {
    return <SkeletonScreen />;
  }

  // 운영자는 항상 목록 최상단 고정 (아직 대화가 없어도 진입 가능하게 노출)
  const operatorThread = operator ? threads.find((t) => t.otherId === operator.id) : null;
  const otherThreads = threads.filter((t) => !operator || t.otherId !== operator.id);

  const filtered = otherThreads.filter((t) => {
    if (filter === '전체') return true;
    if (filter === '회원') return t.otherRole === 'hopeful';
    if (filter === '파트너') return t.otherRole === 'connector';
    if (filter === '운영자') return t.otherRole === 'operator';
    return true;
  });

  // 운영자 본인에게는 '운영자에게 문의하기' 줄이 필요 없다
  const isOperator = user?.role === 'operator';
  const showOperatorRow = !isOperator && operator && (filter === '전체' || filter === '운영자');
  const filterOptions: Filter[] = isOperator
    ? ['전체', '회원', '파트너']
    : user?.role === 'hopeful'
      ? ['전체', '파트너', '운영자']
      : ['전체', '회원', '파트너', '운영자'];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{isOperator ? '문의' : '채팅'}</Text>
      </View>

      <View style={styles.filterRow}>
        {filterOptions.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={pullRefresh}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          showOperatorRow ? (
            <TouchableOpacity
              style={styles.threadRow}
              onPress={() => openThreadWith(operator!.id, operator!.name)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>🛎️</Text>
              </View>
              <View style={styles.threadInfo}>
                <View style={styles.threadTopRow}>
                  <Text style={styles.threadName}>{operator!.name}</Text>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>운영자</Text>
                  </View>
                </View>
                <Text style={styles.threadPreview} numberOfLines={1}>
                  {operatorThread?.lastMessagePreview || '운영자에게 문의하기'}
                </Text>
              </View>
              {operatorThread && operatorThread.unreadCount > 0 && (
                <View style={styles.unreadDot}>
                  <Text style={styles.unreadDotText}>{operatorThread.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          !showOperatorRow ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>대화가 없습니다</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.threadRow} onPress={() => openThreadWith(item.otherId, item.otherName)}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>👤</Text>
            </View>
            <View style={styles.threadInfo}>
              <View style={styles.threadTopRow}>
                <Text style={styles.threadName}>{item.otherName}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{roleLabel(item.otherRole)}</Text>
                </View>
              </View>
              <Text style={styles.threadPreview} numberOfLines={1}>
                {item.lastMessagePreview || '대화를 시작해보세요'}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View style={styles.unreadDot}>
                <Text style={styles.unreadDotText}>{item.unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />

      <Modal visible={activeThreadId !== null} animationType="slide" onRequestClose={closeThread}>
        <KeyboardAvoidingView style={styles.threadContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.threadHeader}>
            <TouchableOpacity onPress={closeThread} style={styles.threadBack}>
              <Text style={styles.threadBackText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.threadHeaderName}>{activeOther?.name}</Text>
            {activeOther && operator?.id !== activeOther.id && user?.role !== 'operator' ? (
              <SafetyActions
                variant="menu"
                targetId={activeOther.id}
                targetName={activeOther.name}
                context="chat"
                onBlocked={() => setActiveOther((o) => (o ? { ...o, iBlocked: true } : o))}
              />
            ) : (
              <View style={{ width: 30 }} />
            )}
          </View>

          <FlatList
            ref={messageListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => {
              const isMine = item.sender_id === user?.id;
              return (
                <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowTheirs]}>
                  <View style={[styles.messageBubble, isMine ? styles.messageBubbleMine : styles.messageBubbleTheirs]}>
                    <Text style={[styles.messageText, isMine && styles.messageTextMine]}>{item.content}</Text>
                  </View>
                </View>
              );
            }}
            onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>{openingId ? '불러오는 중...' : '첫 메시지를 보내보세요'}</Text>
              </View>
            }
          />

          {activeOther?.withdrawn || activeOther?.iBlocked || activeOther?.blockedMe ? (
            <View style={styles.inputRow}>
              <Text style={styles.withdrawnNote}>
                {activeOther.withdrawn
                  ? '탈퇴한 회원이라 메시지를 보낼 수 없어요'
                  : activeOther.iBlocked
                    ? '차단한 상대예요. 마이 › 차단 목록에서 풀 수 있어요'
                    : '메시지를 보낼 수 없는 상대예요'}
              </Text>
            </View>
          ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.messageInput}
              placeholder="메시지 입력"
              placeholderTextColor="#bbb"
              value={messageInput}
              onChangeText={setMessageInput}
              editable={!sending}
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity style={[styles.sendBtn, (sending || !messageInput.trim()) && { opacity: 0.5 }]} onPress={handleSend} disabled={sending || !messageInput.trim()}>
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendBtnText}>전송</Text>}
            </TouchableOpacity>
          </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  withdrawnNote: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    color: '#999',
    paddingVertical: 10,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  placeholder: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: '#999',
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F1ECFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
  },
  threadInfo: {
    flex: 1,
  },
  threadTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  threadName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  roleBadge: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#5B21FF',
  },
  threadPreview: {
    fontSize: 12,
    color: '#999',
  },
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  unreadDotText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  threadContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 50,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  threadBack: {
    width: 30,
  },
  threadBackText: {
    fontSize: 26,
    color: '#333',
  },
  threadHeaderName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageRow: {
    marginBottom: 8,
    flexDirection: 'row',
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowTheirs: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  messageBubbleMine: {
    backgroundColor: '#5B21FF',
  },
  messageBubbleTheirs: {
    backgroundColor: '#F1F1F3',
  },
  messageText: {
    fontSize: 14,
    color: '#333',
  },
  messageTextMine: {
    color: '#fff',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
