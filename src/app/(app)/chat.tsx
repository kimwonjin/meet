import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchThreads, fetchMessages, sendMessage, markThreadRead, getOrCreateThread, findOperator } from '@/lib/chat';

type Filter = '전체' | '회원' | '동맹 연결자' | '연결자' | '운영자';

function roleLabel(otherRole: string, viewerRole: string | undefined) {
  if (otherRole === 'operator') return '운영자';
  if (otherRole === 'hopeful') return '회원';
  if (otherRole === 'connector') return viewerRole === 'hopeful' ? '연결자' : '동맹';
  return '회원';
}

export default function ChatScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ with?: string; name?: string }>();
  const [threads, setThreads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('전체');
  const [operator, setOperator] = useState<{ id: string; name: string } | null>(null);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeOther, setActiveOther] = useState<{ id: string; name: string } | null>(null);
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
      setMessages((prev) => (msgs.length !== prev.length ? msgs : prev));
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [activeThreadId, user?.id]);

  // 대화 목록: 새 메시지가 오면 미리보기와 안 읽은 수를 갱신한다
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`chat-list-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, 500);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  async function load() {
    if (!user) return;
    const [threadList, op] = await Promise.all([fetchThreads(user.id), findOperator()]);
    setThreads(threadList);
    setOperator(op);
    setLoading(false);
  }

  async function openThreadWith(otherId: string, otherName: string | undefined) {
    if (!user) return;
    const threadId = await getOrCreateThread(user.id, otherId);
    if (!threadId) return;
    setActiveThreadId(threadId);
    setActiveOther({ id: otherId, name: otherName || threads.find((t) => t.otherId === otherId)?.otherName || operator?.name || '상대방' });
    const msgs = await fetchMessages(threadId);
    setMessages(msgs);
    await markThreadRead(threadId, user.id);
    load();
  }

  function closeThread() {
    setActiveThreadId(null);
    setActiveOther(null);
    setMessages([]);
  }

  async function handleSend() {
    if (!user || !activeThreadId || !messageInput.trim()) return;
    const content = messageInput.trim();
    setMessageInput('');
    setSending(true);
    try {
      const { error } = await sendMessage(activeThreadId, user.id, content);
      if (error) throw error;
      const msgs = await fetchMessages(activeThreadId);
      setMessages(msgs);
      setTimeout(() => messageListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('메시지 전송 오류:', error);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  // 운영자는 항상 목록 최상단 고정 (아직 대화가 없어도 진입 가능하게 노출)
  const operatorThread = operator ? threads.find((t) => t.otherId === operator.id) : null;
  const otherThreads = threads.filter((t) => !operator || t.otherId !== operator.id);

  const filtered = otherThreads.filter((t) => {
    if (filter === '전체') return true;
    if (filter === '회원') return t.otherRole === 'hopeful';
    if (filter === '동맹 연결자' || filter === '연결자') return t.otherRole === 'connector';
    if (filter === '운영자') return t.otherRole === 'operator';
    return true;
  });

  const showOperatorRow = operator && (filter === '전체' || filter === '운영자');
  const filterOptions: Filter[] = user?.role === 'hopeful'
    ? ['전체', '연결자', '운영자']
    : ['전체', '회원', '동맹 연결자', '운영자'];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>채팅</Text>
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
                  <Text style={styles.roleBadgeText}>{roleLabel(item.otherRole, user?.role)}</Text>
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
            <View style={{ width: 30 }} />
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
          />

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
            <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending || !messageInput.trim()}>
              <Text style={styles.sendBtnText}>전송</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
