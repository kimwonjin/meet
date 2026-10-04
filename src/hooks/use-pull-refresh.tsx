import React, { useCallback, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';

// 목록을 아래로 당기면 다시 불러온다. ScrollView/FlatList의 refreshControl에 넣는다.
export function usePullRefresh(load: () => unknown) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRef.current();
    } finally {
      setRefreshing(false);
    }
  }, []);
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5B21FF" colors={['#5B21FF']} />;
}
