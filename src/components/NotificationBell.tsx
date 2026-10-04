import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import BottomSheet from './BottomSheet';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { fetchNotifications, markAllRead, markOneRead, getUnreadNotificationCount } from '@/lib/notifications';

export default function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [unreadCount, setUnreadCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const poll = () => getUnreadNotificationCount(user.id).then((n) => { if (!cancelled) setUnreadCount(n); });
    poll();
    const interval = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id]);

  async function openCenter() {
    if (!user) return;
    setVisible(true);
    setLoading(true);
    const data = await fetchNotifications(user.id);
    setNotifications(data);
    setLoading(false);
  }

  async function handleMarkAllRead() {
    if (!user) return;
    await markAllRead(user.id);
    toast.show('모든 알림을 읽음으로 표시했어요', 'success');
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function handleTapNotification(n: any) {
    if (!n.read_at) {
      await markOneRead(n.id);
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)));
    }
    setVisible(false);
    if (n.deep_link_route) {
      router.push({ pathname: n.deep_link_route, params: n.deep_link_params || {} });
    }
  }

  return (
    <>
      <TouchableOpacity style={styles.bellBtn} onPress={openCenter}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      <BottomSheet visible={visible} onClose={() => setVisible(false)} title="알림">
        {loading ? (
          <ActivityIndicator size="large" color="#5B21FF" style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>알림이 없습니다</Text>
          </View>
        ) : (
          <>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
                <Text style={styles.markAllText}>모두 읽음으로 표시</Text>
              </TouchableOpacity>
            )}
            {notifications.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.item, !item.read_at && styles.itemUnread]}
                onPress={() => handleTapNotification(item)}
              >
                {!item.read_at && <View style={styles.dot} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  {item.body && <Text style={styles.itemBody}>{item.body}</Text>}
                  <Text style={styles.itemDate}>{new Date(item.created_at).toLocaleString('ko-KR')}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    padding: 6,
  },
  bellIcon: {
    fontSize: 22,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '40%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  sheetHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  markAllBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5B21FF',
  },
  closeBtn: {
    padding: 2,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#999',
  },
  empty: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
  list: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  item: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  itemUnread: {
    backgroundColor: '#FAFAFF',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5B21FF',
    marginTop: 6,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  itemBody: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  itemDate: {
    fontSize: 11,
    color: '#bbb',
  },
});
