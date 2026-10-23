import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import MemberIntro from '@/components/MemberIntro';
import BusinessInfo from '@/components/BusinessInfo';
import { useAuth } from '@/contexts/AuthContext';
import { APP_MAX_WIDTH } from '@/lib/layout';

// 서비스 소개 (/about). 광고·공유용 주소. 로그인 상태면 앱으로, 아니면 가입·로그인으로 이어진다
export default function AboutScreen() {
  const router = useRouter();
  const { user } = useAuth();
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.inner}>
        <Text style={s.brand}>두두인연</Text>
        <Text style={s.title}>믿을 수 있는 파트너가{'\n'}직접 소개해 드려요</Text>
        <Text style={s.sub}>주변에서 소개를 잘해 주던 분들이 파트너로 활동해요. 잘 맞을 분을 골라 소개하고, 만남까지 함께 챙겨요.</Text>
        <MemberIntro showSignup={!user} />
        <TouchableOpacity style={s.secondary} onPress={() => router.replace(user ? '/home' : '/')} accessibilityLabel={user ? '앱으로 가기' : '로그인'}>
          <Text style={s.secondaryT}>{user ? '앱으로 가기 ›' : '이미 계정이 있어요 · 로그인'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/partner')} style={s.partner} accessibilityLabel="파트너로 활동하기">
          <Text style={s.partnerT}>소개해 주는 매니저이신가요? 파트너로 활동하기 ›</Text>
        </TouchableOpacity>
        <BusinessInfo />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingBottom: 40 },
  inner: { width: '100%', maxWidth: APP_MAX_WIDTH, paddingHorizontal: 20 },
  brand: { fontSize: 14, fontWeight: '700', color: '#5B21FF', marginTop: 28 },
  title: { fontSize: 26, fontWeight: '800', color: '#18151E', lineHeight: 36, marginTop: 14, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: '#65626B', lineHeight: 23, marginTop: 10 },
  secondary: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  secondaryT: { fontSize: 14, color: '#65626B' },
  partner: { alignItems: 'center', paddingVertical: 10, marginBottom: 16 },
  partnerT: { fontSize: 13, color: '#5B21FF', fontWeight: '600' },
});
