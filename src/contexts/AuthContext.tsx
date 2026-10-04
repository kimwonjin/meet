import React, { createContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithPhone } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export interface User {
  id: string;
  phone: string;
  name: string;
  role: 'hopeful' | 'connector' | 'operator';
  grade: string;
  birth_date?: string;
}

// 테스트 모드에서 로그인 화면에 보여줄 최근 로그인 계정
export interface RecentLogin {
  phone: string;
  name: string;
  role: User['role'];
}

const RECENT_LOGINS_KEY = 'recent_logins';
const MAX_RECENT_LOGINS = 5;

interface AuthContextType {
  user: User | null;
  recentLogins: RecentLogin[];
  loading: boolean;
  login: (phone: string) => Promise<any>;
  logout: (options?: { forget?: boolean }) => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  refreshUser: (id: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>([]);

  useEffect(() => {
    checkLogin();
  }, []);

  // 앱(탭)으로 돌아올 때마다 서버의 최신 계정 상태를 반영한다 (역할 변경, 다른 기기에서 탈퇴 등)
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userRef.current) refreshUser(userRef.current.id);
    });
    return () => sub.remove();
  }, []);

  async function checkLogin() {
    try {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        const storedUser: User = JSON.parse(stored);
        setUser(storedUser);
        refreshUser(storedUser.id);
      }
      const recent = await AsyncStorage.getItem(RECENT_LOGINS_KEY);
      if (recent) {
        setRecentLogins(JSON.parse(recent));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  // 운영자 승인으로 역할이 바뀌는 등 서버 쪽 변경을 반영한다 (실패해도 저장된 값으로 계속 사용)
  async function refreshUser(id: string) {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (error) return; // 네트워크 오류 등: 저장된 값으로 계속
    // 계정이 없거나 탈퇴한 계정이면 로그아웃 (다른 기기에서 탈퇴한 경우)
    if (!data || data.withdrawn_at) {
      await logout({ forget: true });
      return;
    }
    setUser(data);
    await AsyncStorage.setItem('user', JSON.stringify(data));
  }

  async function login(phone: string) {
    const { data, error } = await loginWithPhone(phone);
    if (error) return { error };

    await AsyncStorage.setItem('user', JSON.stringify(data));
    setUser(data);

    const entry: RecentLogin = { phone: data.phone, name: data.name, role: data.role };
    const nextRecent = [entry, ...recentLogins.filter((r) => r.phone !== entry.phone)].slice(0, MAX_RECENT_LOGINS);
    setRecentLogins(nextRecent);
    await AsyncStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(nextRecent));
    return { data };
  }

  // forget: 탈퇴한 계정은 최근 로그인 목록에서도 지운다
  async function logout(options?: { forget?: boolean }) {
    const current = userRef.current;
    await AsyncStorage.removeItem('user');
    setUser(null);
    if (options?.forget && current) {
      const stored = await AsyncStorage.getItem(RECENT_LOGINS_KEY);
      const next = (stored ? (JSON.parse(stored) as RecentLogin[]) : []).filter((r) => r.phone !== current.phone);
      setRecentLogins(next);
      await AsyncStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(next));
    }
  }

  async function updateUser(updates: Partial<User>) {
    // 가장 최근 값에 합친다 (느린 저장이 더 최근 변경을 덮어쓰지 않도록)
    const base = userRef.current;
    if (!base) return;
    const updated = { ...base, ...updates };
    userRef.current = updated;
    setUser(updated);
    await AsyncStorage.setItem('user', JSON.stringify(updated));
  }

  return (
    <AuthContext.Provider value={{ user, recentLogins, loading, login, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
