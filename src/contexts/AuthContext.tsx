import { isAppHidden } from '@/lib/visibility';
import React, { createContext, useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithPhone } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { detachPush, syncPush } from '@/lib/push';

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

  // 로그인하면 이 기기에서 켜 둔 휴대폰 알림을 지금 계정으로 연결한다 (켜 둔 적이 없으면 아무것도 안 함)
  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => syncPush(user.id), 1500);
    return () => clearTimeout(t);
  }, [user?.id]);

  // 앱(탭)으로 돌아올 때마다 서버의 최신 계정 상태를 반영한다 (역할 변경, 다른 기기에서 탈퇴 등)
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userRef.current) refreshUser(userRef.current.id);
    });
    // 화면을 켜 둔 채로 다른 기기에서 탈퇴·정지돼도 5분 안에 로그아웃되게 한 번씩 확인한다
    // (보내기·신청할 때는 그 자리에서 다시 확인하므로 주기는 길게)
    const timer = setInterval(() => { if (userRef.current && !isAppHidden()) refreshUser(userRef.current.id); }, 300000);
    return () => { sub.remove(); clearInterval(timer); };
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
    // 계정이 없거나 탈퇴했거나 이용이 정지된 계정이면 로그아웃
    if (!data || data.withdrawn_at || data.suspended_at) {
      await logout({ forget: true });
      return;
    }
    // 바뀐 게 없으면 그대로 둔다 (1분마다 확인할 때 화면이 다시 그려지지 않게)
    if (JSON.stringify(data) === JSON.stringify(userRef.current)) return;
    setUser(data);
    await AsyncStorage.setItem('user', JSON.stringify(data));
  }

  async function login(phone: string) {
    const { data, error } = await loginWithPhone(phone);
    if (error) {
      // 없는 번호(탈퇴 등)는 최근 로그인 목록에서도 지운다
      if ((error as { code?: string }).code === 'PGRST116') {
        const nextRecent = recentLogins.filter((r) => r.phone !== phone);
        setRecentLogins(nextRecent);
        await AsyncStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(nextRecent));
      }
      return { error };
    }

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
    // 이 기기로 이전 계정의 휴대폰 알림이 오지 않게 연결을 끊는다 (오래 걸리면 기다리지 않음)
    await Promise.race([detachPush(), new Promise((r) => setTimeout(r, 2000))]);
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
