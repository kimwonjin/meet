import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import InviteLanding from '@/components/InviteLanding';

// 예전 초대 링크 (/invite?p=파트너ID) — 이미 보낸 링크가 계속 열리도록 남겨 둔다
export default function InviteScreen() {
  const { p } = useLocalSearchParams<{ p?: string }>();
  return <InviteLanding partnerId={p} />;
}
