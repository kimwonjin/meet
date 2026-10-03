import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';

function formatPhone(value: string) {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 7) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`;
}

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user, login } = useAuth();

  useEffect(() => {
    if (user) {
      console.log('User detected, navigating to home');
      router.replace('/(app)/home');
    }
  }, [user]);

  async function handleLogin() {
    console.log('Login attempt:', phone);

    if (!phone.replace(/\D/g, '') || phone.replace(/\D/g, '').length !== 11) {
      Alert.alert('오류', '올바른 전화번호를 입력해주세요');
      return;
    }

    setLoading(true);
    try {
      const { error } = await login(phone);
      console.log('Login result:', { error });

      if (error) {
        Alert.alert('오류', '로그인에 실패했습니다');
        return;
      }

      console.log('Login successful');
    } catch (err) {
      console.error('Login error:', err);
      Alert.alert('오류', '로그인 중 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>인연장</Text>
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
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? '로그인 중...' : '시작하기'}</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>계정이 없으신가요? </Text>
          <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.footerLink}>가입하기</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  footerLink: {
    fontSize: 12,
    color: '#5B21FF',
    fontWeight: '700',
  },
});
