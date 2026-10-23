// 처음 온 사람을 위한 서비스 소개 (로그인 화면 아래, /about 페이지 공용)
// 앱이 실제로 하는 일만 적는다 (연락처 전달 시점, 이용권 차감·환불, 파트너 확인 표시 등)
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

const STEPS: [string, string][] = [
  ['가입하고 파트너 고르기', '지역·나이대가 잘 맞는 파트너(소개해 주는 매니저)에게 가입 신청해요'],
  ['파트너가 직접 소개', '파트너가 프로필을 보고 잘 맞을 분을 골라 소개를 제안해요'],
  ['두 분 모두 좋으면 만남', '둘 다 좋다고 하면 날짜를 정하고, 그때 연락처가 채팅으로 전달돼요'],
  ['만남 뒤 마음 알려 주기', '다시 만나고 싶은지 알려 주세요. 두 분 모두 원할 때만 서로에게 알려 드려요'],
];
const SAFE = [
  "파트너가 직접 만나 확인한 회원은 '✓ 파트너 확인'으로 표시돼요",
  '연락처는 두 분이 모두 동의하고 날짜가 정해진 뒤에만 전달돼요',
  '불편한 상대는 언제든 차단하거나 신고할 수 있어요',
  '원하는 상대 조건과 생년월일은 다른 회원에게 보이지 않아요',
];
const COST = [
  '가입은 무료예요',
  '소개 1회 이용권 금액은 파트너마다 달라요 (파트너 정보에서 미리 확인)',
  '답이 없어 자동으로 끝난 소개는 이용권이 차감되지 않아요',
  '남은 이용권은 언제든 환불을 요청할 수 있어요',
];

export default function MemberIntro({ showSignup = true }: { showSignup?: boolean }) {
  const router = useRouter();
  const list = (items: string[]) => items.map((t) => (
    <View key={t} style={s.line}>
      <Text style={s.check}>✓</Text>
      <Text style={s.lineT}>{t}</Text>
    </View>
  ));
  return (
    <View style={s.wrap}>
      <Text style={s.h2}>두두인연은 이렇게 소개받아요</Text>
      {STEPS.map(([t, d], i) => (
        <View key={t} style={s.step}>
          <View style={s.num}><Text style={s.numT}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.stepT}>{t}</Text>
            <Text style={s.stepD}>{d}</Text>
          </View>
        </View>
      ))}

      <Text style={s.h2}>안심하고 만날 수 있게</Text>
      <View style={s.box}>{list(SAFE)}</View>

      <Text style={s.h2}>비용</Text>
      <View style={s.box}>{list(COST)}</View>

      {showSignup && (
        <TouchableOpacity style={s.cta} onPress={() => router.push('/(auth)/signup')} accessibilityLabel="무료로 가입하기">
          <Text style={s.ctaT}>무료로 가입하기</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 8 },
  h2: { fontSize: 17, fontWeight: '800', color: '#211E27', marginTop: 28, marginBottom: 12 },
  step: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#EDE4FF', alignItems: 'center', justifyContent: 'center' },
  numT: { fontSize: 13, fontWeight: '800', color: '#5B21FF' },
  stepT: { fontSize: 15, fontWeight: '700', color: '#322F38' },
  stepD: { fontSize: 13, color: '#65626B', lineHeight: 19, marginTop: 2 },
  box: { backgroundColor: '#F8F7FA', borderRadius: 14, padding: 14, gap: 8 },
  line: { flexDirection: 'row', gap: 8 },
  check: { fontSize: 13, color: '#5B21FF', fontWeight: '800', lineHeight: 20 },
  lineT: { flex: 1, fontSize: 13, color: '#322F38', lineHeight: 20 },
  cta: { marginTop: 24, height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  ctaT: { fontSize: 15, fontWeight: '700', color: '#5B21FF' },
});
