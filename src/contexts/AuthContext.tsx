import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithPhone } from '@/lib/auth';

export interface User {
  id: string;
  phone: string;
  name: string;
  role: 'hopeful' | 'connector' | 'operator';
  grade: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (phone: string) => Promise<any>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkLogin();
  }, []);

  async function checkLogin() {
    try {
      const stored = await AsyncStorage.getItem('user');
      if (stored) {
        setUser(JSON.parse(stored));
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
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
