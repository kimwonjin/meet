// 파트너 → 회원 '프로필 채워 주세요' 요청. 빠진 항목은 앱이 찾아서 알림에 담는다
// 같은 회원에게는 하루 한 번만 (알림이 쌓이지 않게)
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/lib/notifications';
import { useToast } from '@/contexts/ToastContext';

type Member = { id: string; photo_urls?: string[] | null; bio?: string | null; height?: number | null; job?: string | null; education?: string | null; location?: string | null };

export function missingProfileItems(m: Member) {
  return [
    !(m.photo_urls || []).some(Boolean) && '사진',
    !m.bio && '자기소개',
    !m.location && '사는 곳',
    !m.height && '키',
    !m.job && '직업',
    !m.education && '학력',
  ].filter(Boolean) as string[];
}

export default function ProfileFillRequest({ member, partnerName }: { member: Member; partnerName: string }) {
  const toast = useToast();
  const missing = missingProfileItems(member);
  const [sentRecently, setSentRecently] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!missing.length) return;
    let alive = true;
    const since = new Date(Date.now() - 86400000).toISOString();
    supabase.from('notifications').select('id').eq('user_id', member.id).eq('type', 'profile_fill_requested').gte('created_at', since).limit(1)
      .then(({ data }) => alive && setSentRecently(!!data?.length));
    return () => { alive = false; };
  }, [member.id]);

  if (!missing.length) return null;

  async function send() {
    if (sending || sentRecently) return;
    setSending(true);
    try {
      await createNotification({
        userId: member.id,
        type: 'profile_fill_requested',
        title: '프로필을 조금만 더 채워 주세요',
        body: `${partnerName}님이 소개해 드리려면 ${missing.join('·')}이(가) 필요해요`,
        route: '/profile',
        routeParams: { open: 'profile' },
      });
      setSentRecently(true);
      toast.show('✓ 회원에게 프로필 요청을 보냈어요', 'success');
    } catch {
      toast.show('보내지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={s.box}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>비어 있는 항목: {missing.join('·')}</Text>
        <Text style={s.sub}>{sentRecently ? '오늘 요청을 보냈어요. 내일 다시 보낼 수 있어요' : '회원에게 채워 달라고 알림을 보낼 수 있어요'}</Text>
      </View>
      <TouchableOpacity style={[s.btn, (sentRecently || sentRecently === null) && s.btnOff]} onPress={send} disabled={!!sentRecently || sentRecently === null || sending} accessibilityLabel="프로필 채워 달라고 요청하기">
        {sending ? <ActivityIndicator size="small" color="#5B21FF" /> : <Text style={[s.btnT, sentRecently && s.btnTOff]}>{sentRecently ? '보냄' : '요청하기'}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#F8F7FA' },
  title: { fontSize: 13, fontWeight: '700', color: '#322F38' },
  sub: { fontSize: 12, color: '#6E6A75', marginTop: 2 },
  btn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 999, paddingHorizontal: 14, height: 34, minWidth: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  btnOff: { borderColor: '#DCD9E2' },
  btnT: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
  btnTOff: { color: '#736F7A' },
});
