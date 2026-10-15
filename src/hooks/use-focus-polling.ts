import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { isAppHidden, onAppVisible } from '@/lib/visibility';

// 화면이 보이는 동안 주기적으로 다시 불러온다 (다른 사람이 바꾼 매칭·요청 상태 반영).
// 화면에 들어올 때 한 번 즉시 실행한다. 앱이 뒤에 숨어 있는 동안에는 건너뛴다.
export function useFocusPolling(load: () => unknown, intervalMs = 60000, enabled = true) {
  const loadRef = useRef(load);
  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      loadRef.current();
      const id = setInterval(() => { if (!isAppHidden()) loadRef.current(); }, intervalMs);
      // 숨어 있다가 다시 보이면 바로 새로 불러온다 (그동안 건너뛴 조회를 메움)
      const off = onAppVisible(() => loadRef.current());
      return () => { clearInterval(id); off(); };
    }, [enabled, intervalMs])
  );
}
