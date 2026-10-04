import React, { createContext, useContext, useState, useCallback } from 'react';
import { haptic } from '@/lib/haptics';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    // 완료·오류 안내에 짧은 진동을 곁들인다 (폰에서만, 소리는 내지 않음)
    if (type === 'success') haptic.success();
    else if (type === 'error') haptic.warning();
    // 같은 순간 두 번 띄워도 겹치지 않도록 순번을 붙인다
    const id = `${Date.now()}-${++toastSeq}`;
    // 토스트가 성공 아이콘을 따로 그리므로 메시지 앞의 ✓는 뺀다
    const newToast = { id, message: message.replace(/^✓\s*/, ''), type };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <View style={styles.container} pointerEvents="none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const colors = {
    success: '#10B981',
    error: '#EF4444',
    info: '#5B21FF',
  };

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  return (
    <View style={[styles.toast, { backgroundColor: colors[toast.type] }]}>
      <Text style={styles.icon}>{icons[toast.type]}</Text>
      <Text style={styles.message}>{toast.message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 320,
    pointerEvents: 'none',
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
    marginBottom: 8,
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  message: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
});
