import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, type RecentLogin } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// 테스트 단계에서만 최근 로그인 계정 목록을 보여준다 (.env의 EXPO_PUBLIC_TEST_MODE=true)
const TEST_MODE = process.env.EXPO_PUBLIC_TEST_MODE === 'true';

const ROLE_LABELS: Record<RecentLogin['role'], string> = {
  hopeful: '회원',
  connector: '파트너',
  operator: '운영자',
};

function formatPhone(value: string) {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
}

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loadingPhone, setLoadingPhone] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const { user, login, recentLogins } = useAuth();
  const loading = loadingPhone !== null;

  useEffect(() => {
    if (user) {
      router.replace('/(app)/home');
    }
  }, [user]);

  async function loginWith(target: string) {
    if (target.replace(/\D/g, '').length !== 11) {
      toast.show('올바른 전화번호를 입력해주세요', 'error');
      return;
    }

    setLoadingPhone(target);
    try {
      const { error } = await login(target);
      if (error) {
        // PGRST116: 해당 전화번호로 조회된 회원이 없음
        const notFound = (error as { code?: string }).code === 'PGRST116';
        toast.show(notFound ? '가입되지 않은 전화번호입니다' : '로그인에 실패했습니다. 잠시 후 다시 시도해주세요', 'error');
      }
    } catch (err) {
      console.error('Login error:', err);
      toast.show('로그인 중 오류가 발생했습니다', 'error');
    } finally {
      setLoadingPhone(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>두두인연</Text>
      <Text style={styles.subtitle}>사람이 아닌, 지지 인연.</Text>

      <View style={styles.form}>
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

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => loginWith(phone)}
          disabled={loading}
        >
          {loadingPhone === phone ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>시작하기</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>계정이 없으신가요? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.footerLink}>가입하기</Text>
          </TouchableOpacity>
        </View>
      </View>

      {TEST_MODE && recentLogins.length > 0 && (
        <View style={styles.recent}>
          <Text style={styles.label}>최근 로그인 (테스트용)</Text>
          {recentLogins.map((item) => (
            <TouchableOpacity
              key={item.phone}
              style={styles.recentItem}
              onPress={() => loginWith(item.phone)}
              disabled={loading}
            >
              <View style={styles.recentInfo}>
                <Text style={styles.recentName}>{item.name}</Text>
                <Text style={styles.recentPhone}>{item.phone}</Text>
              </View>
              {loadingPhone === item.phone ? (
                <ActivityIndicator color="#5B21FF" />
              ) : (
                <Text style={styles.recentRole}>{ROLE_LABELS[item.role] ?? item.role}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 80,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#5B21FF',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  form: {
    gap: 16,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  footerText: {
    fontSize: 12,
    color: '#999',
  },
  recent: {
    marginTop: 40,
    gap: 8,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  recentInfo: {
    gap: 2,
  },
  recentName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  recentPhone: {
    fontSize: 12,
    color: '#999',
  },
  recentRole: {
    fontSize: 12,
    color: '#666',
  },
  footerLink: {
    fontSize: 12,
    color: '#5B21FF',
    fontWeight: '700',
  },
});
