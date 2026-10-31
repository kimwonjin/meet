import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { clearPendingPartnerApply, consumeJustSignedUp, markJustSignedUp, peekPendingInvite, peekPendingPartnerApply, savePendingPartnerApply } from '@/lib/invite';
import { calculateAge, signUpHopeful } from '@/lib/auth';
import ConsentChecklist, { ConsentItem } from '@/components/ConsentChecklist';
import { recordConsents } from '@/lib/terms';
import { linkPreviousAccount } from '@/lib/withdrawal';

const SIGNUP_CONSENTS: ConsentItem[] = [
  { key: 'age19', label: '만 19세 이상입니다' },
  { key: 'service', label: '서비스 이용약관 동의', doc: 'service' },
  { key: 'privacy', label: '개인정보 수집·이용 동의', doc: 'privacy' },
];
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

function formatPhone(value: string) {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
}

function formatBirthDate(value: string) {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 4) return cleaned;
  if (cleaned.length <= 6) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
}

export default function SignupScreen() {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | null>(null);
  const [loading, setLoading] = useState(false);
  const [consents, setConsents] = useState<string[]>([]);
  const allConsented = SIGNUP_CONSENTS.every((c) => consents.includes(c.key));
  const router = useRouter();
  const { user, login } = useAuth();
  // 가입 목적: 소개받을 회원 / 소개해 주는 파트너(매니저). 파트너로 가입하면 가입 직후 파트너 신청서가 열린다
  const { as } = useLocalSearchParams<{ as?: string }>();
  const [asPartner, setAsPartner] = useState(as === 'partner');
  // 파트너가 보낸 초대 링크로 온 사람은 회원으로만 가입 (고르는 칸을 숨긴다)
  const [invited, setInvited] = useState(false);
  useEffect(() => {
    peekPendingPartnerApply().then((v) => { if (v) setAsPartner(true); });
    peekPendingInvite().then((v) => setInvited(!!v));
  }, []);

  useEffect(() => {
    if (user) {
      router.replace('/(app)/home');
    }
  }, [user]);

  async function handleSignup() {

    if (!phone || !name || !birthDate || !gender) {
      toast.show('모든 항목을 입력해주세요', 'error');
      return;
    }

    if (birthDate.length !== 10) {
      toast.show('생년월일을 완전히 입력해주세요 (YYYY-MM-DD)', 'error');
      return;
    }

    if (calculateAge(birthDate) < 19) {
      toast.show('만 19세 이상만 가입할 수 있어요', 'error');
      return;
    }

    if (!allConsented) {
      toast.show('필수 약관에 동의해주세요', 'error');
      return;
    }

    const phoneCleaned = phone.replace(/\D/g, '');
    if (phoneCleaned.length !== 11) {
      toast.show('올바른 전화번호를 입력해주세요', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signUpHopeful(phone, name, birthDate, gender);

      if (error) {
        const errorMsg = (error as Error).message || '알 수 없는 오류';
        if (errorMsg.includes('duplicate')) {
          // 이미 가입된 번호(두 번 누르기·두 기기 동시 가입 포함)는 예상된 경우라 오류로 남기지 않는다
          toast.show('이미 가입된 전화번호입니다.', 'error');
        } else {
          console.error('Signup error:', error);
          toast.show('가입에 실패했습니다. 잠시 후 다시 시도해주세요', 'error');
        }
        return;
      }

      if (data?.id) await recordConsents(data.id, SIGNUP_CONSENTS.map((c) => c.key));
      // 예전에 같은 번호로 탈퇴한 계정이 있으면 그때의 차단을 이어 받는다
      if (data?.id) await linkPreviousAccount(data.id, phone, name);

      // 파트너로 가입: 로그인하면 파트너 신청서를 바로 연다 (회원으로 바꿨으면 예전 표시를 지운다)
      if (asPartner && !invited) await savePendingPartnerApply();
      else await clearPendingPartnerApply();

      // 로그인 직후 초대 처리가 이 표시를 읽으므로 먼저 켜 두고, 로그인에 실패하면 끈다
      markJustSignedUp();
      const loginResult = await login(phone);

      if (loginResult.error) {
        consumeJustSignedUp();
        toast.show('로그인에 실패했습니다', 'error');
        return;
      }

    } catch (err) {
      console.error('Exception:', err);
      toast.show('오류가 발생했습니다. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setLoading(false);
    }
  }

  // 한 화면 가입: 입력은 위에서 스크롤 없이 끝나고, 가입하기 버튼은 아래에 고정
  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.backBtn} accessibilityLabel="뒤로가기">
            <Text style={styles.back}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{asPartner && !invited ? '파트너 가입' : '회원 가입'}</Text>
        </View>

        {/* 어떤 분으로 가입하는지: 처음부터 고르게 해서 매니저가 마이 메뉴를 찾아다니지 않게 한다 */}
        {!invited && (
          <View style={styles.roleBox}>
            <View style={styles.roleRow} accessibilityRole="radiogroup">
              {([
                [false, '소개받고 싶어요', '회원'],
                [true, '소개해 주고 싶어요', '파트너·매니저'],
              ] as const).map(([v, t, sub]) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.roleOpt, asPartner === v && styles.roleOptOn]}
                  onPress={() => setAsPartner(v)}
                  disabled={loading}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: asPartner === v }}
                  accessibilityLabel={`${t} (${sub})`}
                >
                  <Text style={[styles.roleOptT, asPartner === v && styles.roleOptTOn]}>{t}</Text>
                  <Text style={[styles.roleOptS, asPartner === v && styles.roleOptSOn]}>{sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {asPartner && (
              <Text style={styles.roleHint}>가입하면 바로 파트너 신청서가 열려요. 운영자가 확인하면 회원을 모으고 매칭을 시작할 수 있어요</Text>
            )}
          </View>
        )}

        <View style={styles.form}>
          <View>
            <Text style={styles.label}>전화번호</Text>
            <TextInput
              style={styles.input}
              placeholder="010-0000-0000"
              placeholderTextColor="#DCD9E2"
              value={phone}
              onChangeText={(text) => setPhone(formatPhone(text))}
              keyboardType="phone-pad"
              editable={!loading}
            />
          </View>

          <View>
            <Text style={styles.label}>이름</Text>
            <TextInput
              style={styles.input}
              placeholder="홍길동"
              placeholderTextColor="#DCD9E2"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />
          </View>

          {/* 생년월일·성별은 한 줄에 */}
          <View style={styles.pairRow}>
            <View style={{ flex: 1.2 }}>
              <Text style={styles.label}>생년월일</Text>
              <TextInput
                style={styles.input}
                placeholder="1990-01-01"
                placeholderTextColor="#DCD9E2"
                value={birthDate}
                onChangeText={(text) => setBirthDate(formatBirthDate(text))}
                keyboardType="number-pad"
                editable={!loading}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>성별</Text>
              <View style={styles.genderRow}>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'M' && styles.genderBtnActive]}
                  onPress={() => setGender('M')}
                  accessibilityLabel="남성"
                >
                  <Text style={gender === 'M' ? styles.genderTextActive : styles.genderText}>남성</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'F' && styles.genderBtnActive]}
                  onPress={() => setGender('F')}
                  accessibilityLabel="여성"
                >
                  <Text style={gender === 'F' ? styles.genderTextActive : styles.genderText}>여성</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <ConsentChecklist items={SIGNUP_CONSENTS} checked={consents} onChange={setConsents} disabled={loading} compact />
        </View>
      </ScrollView>

      <View style={styles.bottom}>
        <TouchableOpacity
          style={[styles.button, (loading || !allConsented) && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading || !allConsented}
        >
          <Text style={styles.buttonText}>{loading ? '가입 중...' : asPartner && !invited ? '파트너로 가입하기' : '가입하기'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    paddingRight: 12,
    paddingVertical: 4,
  },
  back: {
    fontSize: 28,
    color: '#322F38',
    lineHeight: 30,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#322F38',
  },
  roleBox: { marginBottom: 18, gap: 8 },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleOpt: { flex: 1, borderWidth: 1.5, borderColor: '#DCD9E2', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center' },
  roleOptOn: { borderColor: '#5B21FF', backgroundColor: '#F5F1FF' },
  roleOptT: { fontSize: 14, fontWeight: '700', color: '#65626B' },
  roleOptTOn: { color: '#5B21FF' },
  roleOptS: { fontSize: 11, color: '#736F7A', marginTop: 2 },
  roleOptSOn: { color: '#7B4DFF' },
  roleHint: { fontSize: 12, color: '#65626B', lineHeight: 18, backgroundColor: '#F8F7FA', borderRadius: 10, padding: 10 },
  pairRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bottom: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1EFF4',
    backgroundColor: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#736F7A',
    marginBottom: 30,
  },
  form: {
    gap: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6E6A75',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DCD9E2',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
  },
  roleCard: {
    borderWidth: 1,
    borderColor: '#DCD9E2',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
  },
  roleCardActive: {
    borderColor: '#5B21FF',
    backgroundColor: '#F5F1FF',
  },
  roleEmoji: {
    fontSize: 40,
    marginBottom: 12,
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#322F38',
    marginBottom: 4,
  },
  roleDesc: {
    fontSize: 13,
    color: '#736F7A',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 6,
  },
  genderBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#DCD9E2',
    borderRadius: 10,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderBtnActive: {
    borderColor: '#5B21FF',
    backgroundColor: '#EDE4FF',
  },
  genderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#736F7A',
  },
  genderTextActive: {
    color: '#5B21FF',
  },
  button: {
    backgroundColor: '#5B21FF',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  footerNote: {
    fontSize: 11,
    color: '#736F7A',
    textAlign: 'center',
    marginTop: 8,
  },
});
