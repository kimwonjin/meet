import { useEffect, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { getUnreadCount } from '@/lib/chat';

// 탭바 활성 색은 앱 강조색 하나로 통일
const TAB_OPTIONS = { headerShown: false, tabBarActiveTintColor: '#5B21FF' };

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

  // 로그인 없이 /matching 같은 주소로 바로 들어오면 로그인 화면으로 보낸다
  if (!user) {
    return <Redirect href="/" />;
  }

  if (user.role === 'operator') {
    return (
      <Tabs screenOptions={TAB_OPTIONS}>
        <Tabs.Screen
          name="settlements"
          options={{
            tabBarLabel: '정산관리',
            tabBarIcon: ({ color }) => <Ionicons name="cash" size={24} color={color} />,
          }}
        />
        {/* 회원·파트너의 운영자 문의를 받는 곳 */}
        <Tabs.Screen
          name="chat"
          options={{
            tabBarLabel: '문의',
            tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses" size={24} color={color} />,
            tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
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
      </Tabs>
    );
  }

  if (user.role === 'connector') {
    return (
      <Tabs screenOptions={TAB_OPTIONS}>
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
    <Tabs screenOptions={TAB_OPTIONS}>
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
          tabBarLabel: '마이',
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" size={24} color={color} />,
        }}
      />
      <Tabs.Screen name="alliances" options={{ href: null }} />
      <Tabs.Screen name="matching" options={{ href: null }} />
      <Tabs.Screen name="settlements" options={{ href: null }} />
    </Tabs>
  );
}
