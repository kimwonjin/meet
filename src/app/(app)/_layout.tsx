import { isAppHidden } from '@/lib/visibility';
import { useEffect, useState } from 'react';
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import { onAppVisible } from '@/lib/visibility';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { getUnreadCount } from '@/lib/chat';
import { consumeJustSignedUp, takePendingInvite, takePendingPartnerApply, trackInvite } from '@/lib/invite';
import { requestJoin } from '@/lib/join';
import { useToast } from '@/contexts/ToastContext';

// 탭바 활성 색은 앱 강조색 하나로 통일
// 탭바 활성 색과 안 읽음 배지 색은 앱 강조색 하나로 통일
const TAB_OPTIONS = { headerShown: false, tabBarActiveTintColor: '#5B21FF', tabBarBadgeStyle: { backgroundColor: '#5B21FF', color: '#fff' } };

export default function AppLayout() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();
  const toast = useToast();
  const pathname = usePathname();

  // 초대 링크로 들어와 가입·로그인한 회원:
  // - 새로 가입했으면 초대한 파트너에게 가입 신청을 자동으로 보내고 파트너 정보로 보낸다
  // - 기존 회원이 로그인했으면 초대 화면으로 돌려보내 직접 신청하게 한다 (이미 가입한 파트너면 그렇게 안내)
  useEffect(() => {
    if (!user) return;
    // 회원이 아닌 계정으로 로그인했으면 저장된 초대는 버린다 (같은 기기의 다른 회원에게 넘어가지 않게)
    if (user.role !== 'hopeful') { takePendingInvite(); return; }
    const signedUp = consumeJustSignedUp();
    takePendingInvite().then(async (inv) => {
      if (!inv) return;
      if (signedUp) {
        if (inv.code) await trackInvite(inv.code, 'SIGNUP', user.id);
        const r = await requestJoin(user, inv.id, inv.code);
        if (r === 'unavailable' || r === 'blocked') {
          // 초대한 파트너가 지금은 활동하지 않아요: 다른 파트너를 둘러보게 한다
          toast.show('초대한 파트너가 지금은 활동하지 않아요. 다른 파트너를 찾아보세요', 'info');
          setTimeout(() => router.push('/connectors'), 300);
          return;
        }
        if (r === 'sent') toast.show('초대한 파트너에게 가입 신청을 보냈어요. 승인되면 알려드릴게요', 'success');
        setTimeout(() => router.push({ pathname: '/connectors', params: { open: inv.id } }), 300);
      } else {
        setTimeout(() => router.push(inv.code ? `/c/${inv.code}` : { pathname: '/invite', params: { p: inv.id } }), 300);
      }
    });
  }, [user?.id]);

  // 파트너 모집 페이지(/partner)에서 '파트너 신청하기'를 누르고 가입·로그인한 경우: 신청서를 바로 연다
  useEffect(() => {
    if (!user || user.role === 'operator') return;
    takePendingPartnerApply().then((want) => {
      if (!want) return;
      if (user.role === 'connector') { toast.show('이미 파트너로 활동 중이에요', 'info'); return; }
      setTimeout(() => router.push({ pathname: '/profile', params: { open: 'partner' } }), 300);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const poll = () => getUnreadCount(user.id).then((n) => { if (!cancelled) setUnreadCount(n); });
    poll();
    // 안 읽은 채팅 수: 1분마다, 앱이 숨어 있으면 건너뜀
    const interval = setInterval(() => { if (!isAppHidden()) poll(); }, 60000);
    const off = onAppVisible(poll);
    return () => { cancelled = true; clearInterval(interval); off(); };
  }, [user?.id]);

  // 화면을 옮길 때마다 안 읽은 채팅 수를 다시 센다 (대화를 읽고 나온 뒤 배지가 남지 않게)
  useEffect(() => {
    if (!user) return;
    getUnreadCount(user.id).then(setUnreadCount);
  }, [pathname, user?.id]);

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
