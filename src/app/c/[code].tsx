import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import InviteLanding from '@/components/InviteLanding';
import { resolveInviteCode } from '@/lib/invite';

// 코드 초대 링크 (/c/AB12CD34). 대소문자 구분 없이 찾는다.
export default function CodeInviteScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [link, setLink] = useState<Awaited<ReturnType<typeof resolveInviteCode>> | undefined>(undefined);

  useEffect(() => {
    resolveInviteCode(String(code || '')).then(setLink);
  }, [code]);

  if (link === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }
  return <InviteLanding partnerId={link?.connectorId} code={link?.active ? link.code : null} inactive={link ? !link.active : false} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
});
