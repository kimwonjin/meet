import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { savePendingPartnerApply } from '@/lib/invite';
import BusinessInfo from '@/components/BusinessInfo';
import { APP_MAX_WIDTH } from '@/lib/layout';

// 파트너 모집 페이지 (/partner). 회사가 파트너를 모을 때 공유하는 링크.
// 주요 행동은 '파트너 신청하기' 하나: 로그인 상태면 바로 신청서, 아니면 가입 후 신청서로 이어진다.
const BENEFITS = [
  { title: '가입비·월회비 0원', body: '사무실도 필요 없어요. 휴대폰 하나로 시작해요.' },
  { title: '만남이 성사되면 80%', body: '회원이 낸 1회 금액에서 수수료 20%를 뺀 금액이 내 정산금이에요.' },
  { title: '동맹으로 회원 풀 확장', body: '다른 파트너와 동맹을 맺으면 서로의 회원끼리도 소개할 수 있어요.' },
];
const STEPS = [
  ['파트너 신청', '이름과 회사명(모임 이름)을 적고 약관에 동의해요.'],
  ['운영자 확인', '운영자가 확인하면 알림으로 알려드려요.'],
  ['회원 초대', '내 초대 링크·QR로 주변 싱글을 초대해요. 가입하면 내 회원으로 신청이 와요.'],
  ['매칭 제안', '어울릴 두 사람을 골라 제안하면, 날짜 조율부터 정산까지 앱이 챙겨요.'],
];
const FAQ = [
  ['직원으로 일하는 건가요?', '아니요. 독립 파트너로, 활동 시간과 1회 금액을 직접 정해요.'],
  ['회원이 몇 명 있어야 하나요?', '2명부터 매칭할 수 있어요. 회원이 적어도 동맹 파트너의 회원과 연결할 수 있어요.'],
  ['정산은 어떻게 받나요?', '만남이 끝날 때마다 정산금이 쌓이고, 원할 때 출금 신청하면 계좌로 보내드려요.'],
];

export default function PartnerRecruitScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [going, setGoing] = useState(false);

  async function apply(to: '/signup' | '/' = '/signup') {
    if (going) return;
    if (user?.role === 'connector') {
      toast.show('이미 파트너로 활동 중이에요', 'info');
      router.replace('/home');
      return;
    }
    setGoing(true);
    if (user) {
      router.replace({ pathname: '/profile', params: { open: 'partner' } });
      return;
    }
    await savePendingPartnerApply();
    router.replace(to);
  }

  const cta = (
    <TouchableOpacity style={styles.primary} onPress={() => apply('/signup')} disabled={going} accessibilityLabel="파트너 신청하기">
      {going ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>파트너 신청하기</Text>}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.inner}>
        <Text style={styles.brand}>두두인연 파트너</Text>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>주변 싱글을 이어주던{'\n'}당신의 소개,{'\n'}이제 수익이 됩니다</Text>
          <Text style={styles.heroSub}>모임에서, 회사에서, 동네에서 소개를 해 주던 분이라면 두두인연 파트너로 시작해 보세요.</Text>
          {cta}
          {!user && (
            <TouchableOpacity onPress={() => apply('/')} disabled={going} style={styles.secondary}>
              <Text style={styles.secondaryText}>이미 계정이 있어요 · 로그인</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefit}>
              <Text style={styles.benefitTitle}>{b.title}</Text>
              <Text style={styles.benefitBody}>{b.body}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.h2}>시작은 이렇게</Text>
        {STEPS.map(([t, d], i) => (
          <View key={t} style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumT}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{t}</Text>
              <Text style={styles.stepBody}>{d}</Text>
            </View>
          </View>
        ))}

        <View style={styles.example}>
          <Text style={styles.exampleTitle}>예를 들어</Text>
          <Text style={styles.exampleBody}>1회 금액을 50,000원으로 정하고 한 달에 4쌍이 만나면{'\n'}두 회원 몫 8회 × 40,000원 = <Text style={styles.exampleStrong}>320,000원</Text>이 정산금으로 쌓여요.</Text>
          <Text style={styles.exampleNote}>예시일 뿐이며, 실제 금액은 회원 수와 성사 건수에 따라 달라요.</Text>
        </View>

        <Text style={styles.h2}>자주 묻는 질문</Text>
        {FAQ.map(([q, a]) => (
          <View key={q} style={styles.faq}>
            <Text style={styles.faqQ}>{q}</Text>
            <Text style={styles.faqA}>{a}</Text>
          </View>
        ))}

        <View style={{ marginTop: 24 }}>{cta}</View>
        <BusinessInfo />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  content: { alignItems: 'center', paddingBottom: 40 },
  inner: { width: '100%', maxWidth: APP_MAX_WIDTH, paddingHorizontal: 20 },
  brand: { fontSize: 14, fontWeight: '700', color: '#5B21FF', marginTop: 28 },
  hero: { marginTop: 16, paddingBottom: 28, borderBottomWidth: 1, borderBottomColor: '#ECEAF1' },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#18151E', lineHeight: 38, letterSpacing: -0.5 },
  heroSub: { fontSize: 15, color: '#65626B', lineHeight: 23, marginTop: 12, marginBottom: 24 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 10, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#65626B', fontSize: 13, textDecorationLine: 'underline' },
  benefits: { marginTop: 8 },
  benefit: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#ECEAF1' },
  benefitTitle: { fontSize: 17, fontWeight: '700', color: '#18151E' },
  benefitBody: { fontSize: 14, color: '#65626B', marginTop: 6, lineHeight: 21 },
  h2: { fontSize: 18, fontWeight: '700', color: '#18151E', marginTop: 32, marginBottom: 8 },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F4F1FF', alignItems: 'center', justifyContent: 'center' },
  stepNumT: { color: '#5B21FF', fontWeight: '700' },
  stepTitle: { fontSize: 15, fontWeight: '700', color: '#18151E' },
  stepBody: { fontSize: 14, color: '#65626B', marginTop: 2, lineHeight: 20 },
  example: { marginTop: 24, paddingVertical: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: '#5B21FF' },
  exampleTitle: { fontSize: 13, color: '#5B21FF', fontWeight: '700' },
  exampleBody: { fontSize: 14, color: '#322F38', marginTop: 6, lineHeight: 22 },
  exampleStrong: { fontWeight: '800', color: '#18151E' },
  exampleNote: { fontSize: 12, color: '#98959E', marginTop: 8 },
  faq: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1EFF4' },
  faqQ: { fontSize: 15, fontWeight: '700', color: '#18151E' },
  faqA: { fontSize: 14, color: '#65626B', marginTop: 4, lineHeight: 20 },
});
