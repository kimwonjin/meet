import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

// 화면이 보이는 동안 주기적으로 다시 불러온다 (다른 사람이 바꾼 매칭·요청 상태 반영).
// 화면에 들어올 때 한 번 즉시 실행한다.
export function useFocusPolling(load: () => unknown, intervalMs = 15000, enabled = true) {
  const loadRef = useRef(load);
  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      loadRef.current();
      const id = setInterval(() => loadRef.current(), intervalMs);
      return () => clearInterval(id);
    }, [enabled, intervalMs])
  );
}
