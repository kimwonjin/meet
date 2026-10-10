import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Avatar } from './ProfilePhoto';
import BusinessInfo from './BusinessInfo';
import { formatRegions, partnerIntro } from '@/lib/format';
import { savePendingInvite, trackInvite } from '@/lib/invite';
import { getJoinState, JoinState, requestJoin } from '@/lib/join';
import { adsAllowed, useBusiness } from '@/lib/business';
import { fetchConnectorReviews, formatStars, Review } from '@/lib/reviews';

// 공개 소개에 보여도 되는 항목만 읽는다 (회원 정보·연락처·계좌는 읽지 않는다)
type Partner = {
  id: string; business_name?: string; name?: string; photo_urls?: string[]; verified?: boolean;
  main_region?: string; career?: string; intro?: string; service_description?: string; fee_per_session?: number;
};
type Overview = { male: number; female: number; settled: number };

// 파트너가 보낸 초대 링크로 들어오는 화면 (/invite?p=파트너ID, /c/코드)
// - 국내결혼중개업 신고번호가 등록되어 있으면: 파트너 공개 소개 + 가입
// - 신고 전이면: 광고가 되지 않도록 파트너 소개 없이 가입 화면만
// inactive: 파트너가 끈 링크 → 안내만 보여준다
export default function InviteLanding({ partnerId, code, inactive }: { partnerId?: string; code?: string | null; inactive?: boolean }) {
  const p = inactive ? undefined : partnerId;
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { ready: bizReady } = useBusiness();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [going, setGoing] = useState(false);
  // 로그인한 회원: 이 파트너와의 가입 상태
  const [joinState, setJoinState] = useState<JoinState | null>(null);
  const [applying, setApplying] = useState(false);
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  useEffect(() => {
    (async () => {
      if (!p) return setPartner(null);
      const [{ data: conn }, { data: u }] = await Promise.all([
        supabase
          .from('connectors')
          .select('id, business_name, verified, main_region, fee_per_session, career, intro, service_description')
          .eq('id', p)
          .eq('status', 'approved')
          .maybeSingle(),
        supabase.from('users').select('id, name, photo_urls, withdrawn_at, suspended_at').eq('id', p).maybeSingle(),
      ]);
      if (!conn || !u || u.withdrawn_at || u.suspended_at) return setPartner(null);
      setPartner({ ...conn, name: u.name, photo_urls: u.photo_urls ?? [] });
      // 링크 열람 기록 (코드 링크만, 봇·같은 방문 중복·파트너 본인은 빼고 센다)
      if (code && userIdRef.current !== p) trackInvite(code, 'CLICK');
    })();
  }, [p]);

  const showProfile = bizReady && adsAllowed();

  // 공개 소개용 실적: 회원 수(남/여)와 성사된 만남 수만 쓴다 (연령·지역 분포는 보여주지 않는다)
  useEffect(() => {
    if (!partner || !showProfile) return;
    supabase.rpc('fn_partner_overview', { p_connector_id: partner.id, p_include_allies: false }).then(({ data, error }) => {
      if (!error && data) setOverview({ male: Number(data.male) || 0, female: Number(data.female) || 0, settled: Number(data.settled) || 0 });
    });
    fetchConnectorReviews(partner.id).then(setReviews).catch(() => setReviews([]));
  }, [partner?.id, showProfile]);

  useEffect(() => {
    if (!partner || user?.role !== 'hopeful') return;
    getJoinState(user.id, partner.id).then(setJoinState);
  }, [partner?.id, user?.id]);

  async function join(to: '/signup' | '/') {
    if (!partner) return;
    setGoing(true);
    await savePendingInvite(partner.id, code, to === '/signup' ? 'signup' : 'login');
    router.replace(to);
  }

  async function apply() {
    if (!partner || !user || applying) return;
    setApplying(true);
    const r = await requestJoin(user, partner.id, code);
    setApplying(false);
    if (r === 'error') {
      toast.show('가입 신청을 보내지 못했어요. 잠시 후 다시 시도해주세요', 'error');
      return;
    }
    if (r === 'sent') toast.show('가입 신청을 보냈어요. 파트너가 승인하면 알려드릴게요', 'success');
    setJoinState(r === 'approved' ? 'approved' : 'pending');
  }

  function openInApp() {
    if (!partner) return;
    router.replace({ pathname: '/connectors', params: { open: partner.id } });
  }

  if (partner === undefined || !bizReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5B21FF" />
      </View>
    );
  }

  const title = partner?.business_name || partner?.name || '파트너';
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Image source={require('../../assets/images/icon.png')} style={styles.logo} />
      <Text style={styles.brand}>두두인연</Text>

      {!partner ? (
        <>
          <Text style={styles.headline}>{inactive ? '더 이상 사용하지 않는 초대 링크예요' : '초대장을 찾을 수 없어요'}</Text>
          <Text style={styles.sub}>{inactive ? '파트너가 이 링크를 껐어요. 두두인연에서 다른 파트너를 찾아보세요.' : '링크가 잘못되었거나 더 이상 활동하지 않는 파트너예요.'}</Text>
          <TouchableOpacity style={styles.primary} onPress={() => router.replace('/')}>
            <Text style={styles.primaryText}>두두인연 둘러보기</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {showProfile ? (
            <>
              <Text style={styles.headline}>{title}에서{'\n'}초대장이 도착했어요 💌</Text>
              <Text style={styles.sub}>가입하면 이 파트너에게 바로 연결돼요. 파트너가 회원님께 맞는 분을 직접 소개해 드려요.</Text>

              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Avatar photoUrls={partner.photo_urls} size={56} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{title}</Text>
                    <Text style={styles.cardMeta}>{partner.name} 파트너{partner.verified ? ' · ✓ 인증' : ''}</Text>
                  </View>
                </View>
                {!!partner.career && <Text style={styles.career}>경력 · {partner.career}</Text>}
                {!!partnerIntro(partner) && <Text style={styles.intro}>{partnerIntro(partner)}</Text>}
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
                {overview && (
                  <View style={styles.facts}>
                    <View style={styles.fact}>
                      <Text style={styles.factLabel}>함께하는 회원</Text>
                      <Text style={styles.factValue}>남 {overview.male} · 여 {overview.female}</Text>
                    </View>
                    <View style={styles.fact}>
                      <Text style={styles.factLabel}>성사된 만남</Text>
                      <Text style={styles.factValue}>{overview.settled}건</Text>
                    </View>
                  </View>
                )}
                {reviews.length > 0 && (
                  <View style={styles.reviews}>
                    <Text style={styles.reviewSummary}>★ {avg.toFixed(1)} · 후기 {reviews.length}개</Text>
                    {reviews.slice(0, 3).map((r) => (
                      <View key={r.id} style={styles.review}>
                        <Text style={styles.reviewStars}>{formatStars(r.rating)} <Text style={styles.reviewWriter}>{r.writerName}</Text></Text>
                        {!!r.content && <Text style={styles.reviewText} numberOfLines={3}>{r.content}</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.headline}>두두인연에{'\n'}초대받았어요 💌</Text>
              <Text style={styles.sub}>가입하면 초대한 파트너에게 바로 연결돼요.</Text>
            </>
          )}

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
            joinState === null ? (
              <ActivityIndicator color="#5B21FF" style={{ marginTop: 32 }} />
            ) : joinState === 'approved' ? (
              <>
                <Text style={styles.note}>이미 가입되어 있어요. 이 파트너가 회원님께 맞는 분을 소개해 드리고 있어요.</Text>
                <TouchableOpacity style={styles.primary} onPress={() => router.replace('/home')}>
                  <Text style={styles.primaryText}>홈으로</Text>
                </TouchableOpacity>
              </>
            ) : joinState === 'pending' ? (
              <>
                <Text style={styles.note}>가입 신청을 보냈어요. 파트너가 승인하면 알려드릴게요.</Text>
                <TouchableOpacity style={styles.primary} onPress={openInApp}>
                  <Text style={styles.primaryText}>파트너 정보 보기</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={[styles.primary, applying && styles.disabled]} onPress={apply} disabled={applying}>
                  {applying ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>이 파트너에게 가입 신청</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={openInApp} style={styles.secondary}>
                  <Text style={styles.secondaryText}>파트너 정보 자세히 보기</Text>
                </TouchableOpacity>
              </>
            )
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
      <View style={styles.footer}>
        <BusinessInfo />
      </View>
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
  reviews: { marginTop: 16 },
  reviewSummary: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 8 },
  review: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6 },
  reviewStars: { fontSize: 13, color: '#5B21FF' },
  reviewWriter: { fontSize: 12, color: '#999' },
  reviewText: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 19 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  secondary: { alignItems: 'center', paddingVertical: 16 },
  secondaryText: { fontSize: 14, color: '#777', textDecorationLine: 'underline' },
  note: { textAlign: 'center', fontSize: 13, color: '#888', marginTop: 24, lineHeight: 19 },
  footer: { marginTop: 32 },
});
