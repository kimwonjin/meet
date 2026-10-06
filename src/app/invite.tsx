import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/ProfilePhoto';
import { formatRegions } from '@/lib/format';
import { savePendingInvite } from '@/lib/invite';

type Partner = { id: string; business_name?: string; name?: string; photo_urls?: string[]; main_region?: string; career?: string; intro?: string; fee_per_session?: number };

// 파트너가 보낸 초대 링크로 들어오는 화면 (/invite?p=파트너ID)
export default function InviteScreen() {
  const { p } = useLocalSearchParams<{ p?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    (async () => {
      if (!p) return setPartner(null);
      const [{ data: conn }, { data: u }] = await Promise.all([
        supabase.from('connectors').select('*').eq('id', p).eq('status', 'approved').maybeSingle(),
        supabase.from('users').select('id, name, photo_urls, withdrawn_at, suspended_at').eq('id', p).maybeSingle(),
      ]);
      if (!conn || !u || u.withdrawn_at || u.suspended_at) return setPartner(null);
      setPartner({ ...conn, name: u.name, photo_urls: u.photo_urls ?? [] });
    })();
  }, [p]);

  async function join(to: '/signup' | '/') {
    if (!partner) return;
    setGoing(true);
    await savePendingInvite(partner.id);
    router.replace(to);
  }

  function openInApp() {
    if (!partner) return;
    router.replace({ pathname: '/connectors', params: { open: partner.id } });
  }

  if (partner === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  const title = partner?.business_name || partner?.name || '파트너';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Image source={require('../../assets/images/icon.png')} style={styles.logo} />
      <Text style={styles.brand}>두두인연</Text>

      {!partner ? (
        <>
          <Text style={styles.headline}>초대장을 찾을 수 없어요</Text>
          <Text style={styles.sub}>링크가 잘못되었거나 더 이상 활동하지 않는 파트너예요.</Text>
          <TouchableOpacity style={styles.primary} onPress={() => router.replace('/')}>
            <Text style={styles.primaryText}>두두인연 둘러보기</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.headline}>{title}에서{'\n'}초대장이 도착했어요 💌</Text>
          <Text style={styles.sub}>가입하면 이 파트너에게 바로 연결돼요. 파트너가 회원님께 맞는 분을 직접 소개해 드려요.</Text>

          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Avatar photoUrls={partner.photo_urls} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{title}</Text>
                <Text style={styles.cardMeta}>{partner.name} 파트너 · ✓ 인증</Text>
              </View>
            </View>
            {!!partner.career && <Text style={styles.career}>경력 · {partner.career}</Text>}
            {!!partner.intro && <Text style={styles.intro}>{partner.intro}</Text>}
            <View style={styles.facts}>
              {!!formatRegions(partner.main_region) && (
                <View style={styles.fact}>
                  <Text style={styles.factLabel}>소개 지역</Text>
                  <Text style={styles.factValue}>{formatRegions(partner.main_region)}</Text>
                </View>
              )}
              {!!partner.fee_per_session && (
                <View style={styles.fact}>
                  <Text style={styles.factLabel}>1회 소개 비용</Text>
                  <Text style={styles.factValue}>{partner.fee_per_session.toLocaleString()}원</Text>
                </View>
              )}
            </View>
          </View>

          {!user ? (
            <>
              <TouchableOpacity style={[styles.primary, going && styles.disabled]} onPress={() => join('/signup')} disabled={going}>
                {going ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>가입하고 연결하기</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => join('/')} disabled={going} style={styles.secondary}>
                <Text style={styles.secondaryText}>이미 계정이 있어요 · 로그인</Text>
              </TouchableOpacity>
            </>
          ) : user.role === 'hopeful' ? (
            <TouchableOpacity style={styles.primary} onPress={openInApp}>
              <Text style={styles.primaryText}>파트너 정보 보고 가입요청하기</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.note}>파트너·운영자 계정으로는 초대를 받을 수 없어요. 회원 계정으로 열어주세요.</Text>
              <TouchableOpacity style={styles.primary} onPress={() => router.replace('/home')}>
                <Text style={styles.primaryText}>홈으로</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  page: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingTop: 64, alignItems: 'stretch', maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { width: 56, height: 56, borderRadius: 14, alignSelf: 'center' },
  brand: { textAlign: 'center', fontSize: 14, fontWeight: '700', color: '#5B21FF', marginTop: 8 },
  headline: { textAlign: 'center', fontSize: 22, fontWeight: '800', color: '#222', marginTop: 28, lineHeight: 31 },
  sub: { textAlign: 'center', fontSize: 14, color: '#777', marginTop: 10, lineHeight: 21 },
  card: { marginTop: 28, borderRadius: 16, backgroundColor: '#F7F4FF', padding: 18 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardName: { fontSize: 17, fontWeight: '700', color: '#222' },
  cardMeta: { fontSize: 13, color: '#5B21FF', marginTop: 3, fontWeight: '600' },
  career: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 14 },
  intro: { fontSize: 14, color: '#555', marginTop: 6, lineHeight: 21 },
  facts: { flexDirection: 'row', gap: 8, marginTop: 14 },
  fact: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  factLabel: { fontSize: 12, color: '#888' },
  factValue: { fontSize: 14, fontWeight: '700', color: '#222', marginTop: 4 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  secondary: { alignItems: 'center', paddingVertical: 16 },
  secondaryText: { fontSize: 14, color: '#777', textDecorationLine: 'underline' },
  note: { textAlign: 'center', fontSize: 13, color: '#888', marginTop: 24 },
});
