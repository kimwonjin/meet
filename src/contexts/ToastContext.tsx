import React, { createContext, useContext, useState, useCallback } from 'react';
import { haptic } from '@/lib/haptics';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type ToastType = 'success' | 'error' | 'info';

// 토스트 안의 버튼 하나 (예: '동맹 찾기'). 버튼이 있으면 조금 더 오래 보여 준다
type ToastAction = { label: string; onPress: () => void };

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  show: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const show = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
    // 완료·오류 안내에 짧은 진동을 곁들인다 (폰에서만, 소리는 내지 않음)
    if (type === 'success') haptic.success();
    else if (type === 'error') haptic.warning();
    // 같은 순간 두 번 띄워도 겹치지 않도록 순번을 붙인다
    const id = `${Date.now()}-${++toastSeq}`;
    // 토스트가 성공 아이콘을 따로 그리므로 메시지 앞의 ✓는 뺀다
    const newToast = { id, message: message.replace(/^✓\s*/, ''), type, action };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, action ? 5000 : 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
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

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    // 버튼이 있는 토스트만 누를 수 있게 (빈 곳은 아래 화면으로 터치가 지나간다)
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </View>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
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
    <View style={[styles.toast, { backgroundColor: colors[toast.type] }]} pointerEvents={toast.action ? 'auto' : 'none'}>
      <Text style={styles.icon}>{icons[toast.type]}</Text>
      <Text style={styles.message}>{toast.message}</Text>
      {toast.action && (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => { onDismiss(); toast.action!.onPress(); }}
          accessibilityLabel={toast.action.label}
          hitSlop={8}
        >
          <Text style={styles.actionText}>{toast.action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 320,
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
  actionBtn: { backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  message: {
    flex: 1,
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
});
