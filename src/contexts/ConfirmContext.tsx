import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  // 삭제·해지처럼 되돌릴 수 없는 액션이면 확인 버튼을 빨간색으로 표시
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

// 되돌릴 수 없는 액션 확인 전용 모달. 그 외에는 BottomSheet를 쓴다.
// 사용: const confirm = useConfirm(); if (!(await confirm({ title: '...' }))) return;
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function close(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* 열 때마다 새로 그려야 이미 열려 있는 바텀시트보다 위에 뜬다 (웹에서는 먼저 그린 창이 아래로 깔림) */}
      {options !== null && (
      <Modal visible transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close(false)} />
          <View style={styles.dialog}>
            <Text style={styles.title}>{options?.title}</Text>
            {!!options?.message && <Text style={styles.message}>{options.message}</Text>}
            <View style={styles.buttons}>
              <TouchableOpacity style={[styles.button, styles.cancel]} onPress={() => close(false)}>
                <Text style={styles.cancelText}>{options?.cancelText ?? '취소'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, options?.destructive ? styles.destructive : styles.primary]}
                onPress={() => close(true)}
              >
                <Text style={styles.confirmText}>{options?.confirmText ?? '확인'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used within ConfirmProvider');
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#322F38',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: '#65626B',
    marginTop: 8,
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 10,
  },
  cancel: {
    backgroundColor: '#EFEDF2',
  },
  primary: {
    backgroundColor: '#5B21FF',
  },
  destructive: {
    backgroundColor: '#E53935',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#65626B',
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
