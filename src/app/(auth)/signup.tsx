import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { signUpHopeful } from '@/lib/auth';
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
  const [step, setStep] = useState<'role' | 'form'>('form');
  const [role, setRole] = useState<'hopeful' | 'connector'>('hopeful');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user, login } = useAuth();

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

    const phoneCleaned = phone.replace(/\D/g, '');
    if (phoneCleaned.length !== 11) {
      toast.show('올바른 전화번호를 입력해주세요', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signUpHopeful(phone, name, birthDate, gender);

      if (error) {
        console.error('Signup error:', error);
        const errorMsg = (error as Error).message || '알 수 없는 오류';
        if (errorMsg.includes('duplicate')) {
          toast.show('이미 가입된 전화번호입니다.', 'error');
        } else {
          toast.show('가입에 실패했습니다. 잠시 후 다시 시도해주세요', 'error');
        }
        return;
      }

      const loginResult = await login(phone);

      if (loginResult.error) {
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

  if (step === 'role') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>역할 선택</Text>
        <Text style={styles.subtitle}>어떤 역할로 시작하시겠어요?</Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            setRole('hopeful');
            setStep('form');
          }}
        >
          <Text style={styles.buttonText}>가입하기</Text>
        </TouchableOpacity>
        <Text style={styles.footerNote}>중개사는 가입 후 설정에서 신청할 수 있습니다</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity onPress={() => setStep('role')}>
        <Text style={styles.back}>← 뒤로가기</Text>
      </TouchableOpacity>

      <Text style={styles.title}>회원 가입</Text>

      <View style={styles.form}>
        <View>
          <Text style={styles.label}>전화번호</Text>
          <TextInput
            style={styles.input}
            placeholder="010-0000-0000"
            placeholderTextColor="#ddd"
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
            placeholderTextColor="#ddd"
            value={name}
            onChangeText={setName}
            editable={!loading}
          />
        </View>

        <View>
          <Text style={styles.label}>생년월일</Text>
          <TextInput
            style={styles.input}
            placeholder="1990-01-01"
            placeholderTextColor="#ddd"
            value={birthDate}
            onChangeText={(text) => setBirthDate(formatBirthDate(text))}
            keyboardType="number-pad"
            editable={!loading}
          />
        </View>

        <View>
          <Text style={styles.label}>성별</Text>
          <View style={styles.genderRow}>
            <TouchableOpacity
              style={[styles.genderBtn, gender === 'M' && styles.genderBtnActive]}
              onPress={() => setGender('M')}
            >
              <Text style={gender === 'M' ? styles.genderTextActive : styles.genderText}>남성</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.genderBtn, gender === 'F' && styles.genderBtnActive]}
              onPress={() => setGender('F')}
            >
              <Text style={gender === 'F' ? styles.genderTextActive : styles.genderText}>여성</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignup}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? '가입 중...' : '가입하기'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 50,
    backgroundColor: '#fff',
  },
  back: {
    fontSize: 14,
    color: '#5B21FF',
    fontWeight: '700',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    marginBottom: 30,
  },
  form: {
    gap: 18,
    paddingBottom: 40,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#bbb',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
  },
  roleCard: {
    borderWidth: 1,
    borderColor: '#ddd',
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
    color: '#333',
    marginBottom: 4,
  },
  roleDesc: {
    fontSize: 13,
    color: '#999',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  genderBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  genderBtnActive: {
    borderColor: '#5B21FF',
    backgroundColor: '#EDE4FF',
  },
  genderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#999',
  },
  genderTextActive: {
    color: '#5B21FF',
  },
  button: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  footerNote: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginTop: 12,
  },
});
