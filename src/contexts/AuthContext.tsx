import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithPhone } from '@/lib/auth';

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
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentLogins, setRecentLogins] = useState<RecentLogin[]>([]);

  useEffect(() => {
    checkLogin();
  }, []);

  async function checkLogin() {
    try {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        setUser(JSON.parse(stored));
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

  async function logout() {
    await AsyncStorage.removeItem('user');
    setUser(null);
  }

  async function updateUser(updates: Partial<User>) {
    if (!user) return;
    const updated = { ...user, ...updates };
    setUser(updated);
    await AsyncStorage.setItem('user', JSON.stringify(updated));
  }

  return (
    <AuthContext.Provider value={{ user, recentLogins, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
