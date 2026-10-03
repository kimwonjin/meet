import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { getUnreadCount } from '@/lib/chat';

export default function AppLayout() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const poll = () => getUnreadCount(user.id).then((n) => { if (!cancelled) setUnreadCount(n); });
    poll();
    const interval = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id]);

  if (user?.role === 'operator') {
    return (
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="settlements"
          options={{
            tabBarLabel: '정산관리',
            tabBarIcon: ({ color }) => <Ionicons name="cash" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            tabBarLabel: '설정',
            tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          }}
        />
        <Tabs.Screen name="home" options={{ href: null }} />
        <Tabs.Screen name="connectors" options={{ href: null }} />
        <Tabs.Screen name="matching" options={{ href: null }} />
        <Tabs.Screen name="alliances" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
      </Tabs>
    );
  }

  if (user?.role === 'connector') {
    return (
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen
          name="home"
          options={{
            tabBarLabel: '홈',
            tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="connectors"
          options={{
            tabBarLabel: '회원',
            tabBarIcon: ({ color }) => <Ionicons name="people" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="matching"
          options={{
            tabBarLabel: '매칭',
            tabBarIcon: ({ color }) => <Ionicons name="link" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            tabBarLabel: '채팅',
            tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses" size={24} color={color} />,
            tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            tabBarLabel: '마이',
            tabBarIcon: ({ color }) => <Ionicons name="person-circle" size={24} color={color} />,
          }}
        />
        <Tabs.Screen name="alliances" options={{ href: null }} />
        <Tabs.Screen name="settlements" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="home"
        options={{
          tabBarLabel: '홈',
          tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="connectors"
        options={{
          tabBarLabel: '파트너',
          tabBarIcon: ({ color }) => <Ionicons name="people" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          tabBarLabel: '채팅',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses" size={24} color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: '프로필',
          tabBarIcon: ({ color }) => <Ionicons name="person" size={24} color={color} />,
        }}
      />
      <Tabs.Screen name="alliances" options={{ href: null }} />
      <Tabs.Screen name="matching" options={{ href: null }} />
      <Tabs.Screen name="settlements" options={{ href: null }} />
    </Tabs>
  );
}
