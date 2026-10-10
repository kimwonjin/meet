import React, { useState, useEffect, useRef } from 'react';
import SkeletonScreen from '@/components/Skeleton';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusPolling } from '@/hooks/use-focus-polling';
import { supabase } from '@/lib/supabase';
import { requestJoin } from '@/lib/join';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { formatRegions, partnerIntro } from '@/lib/format';
import { fetchConnectorReviews, fetchReviewSummaries, Review, ReviewSummary } from '@/lib/reviews';
import ReviewList from '@/components/ReviewList';
import SafetyActions from '@/components/SafetyActions';
import MemberProfileView from '@/components/MemberProfileView';
import { useMemberFilter } from '@/components/MemberFilter';
import PartnerComposition from '@/components/PartnerComposition';
import BottomSheet from '@/components/BottomSheet';
import { Avatar, PhotoList } from '@/components/ProfilePhoto';
import { purchasePackage, getCredit, getFreeCredit, freeWithinAvailable, fetchFreeGiven, grantFreeCredit, FREE_COUNT_OPTIONS, PACKAGE_OPTIONS } from '@/lib/payments';
import { useConfirm } from '@/contexts/ConfirmContext';
import NotificationBell from '@/components/NotificationBell';
import { createNotification } from '@/lib/notifications';

interface Connector {
  id: string;
  business_name: string;
  verified: boolean;
  created_at?: string;
  // hopeful 목록: 승인 여부와 파트너 정보
  name?: string;
  is_approved?: boolean;
  is_pending?: boolean;
  fee_per_session?: number;
  matching_count?: number;
  main_region?: string;
  service_description?: string;
  ally_connector_id?: string;
  ally_connector_name?: string;
  intro?: string;
  career?: string;
  partner_photo_urls?: string[];
  // connector가 받은 요청 목록: 회원 프로필 정보
  birth_date?: string;
  gender?: string;
  age?: number;
  photo_urls?: string[];
  height?: number;
  location?: string;
  job?: string;
  education?: string;
  bio?: string;
  religion?: string;
  smoking?: string;
  drinking?: string;
  body_type?: string;
}

export default function ConnectorsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  // 파트너: 무료 이용권을 이미 준 내 회원 (null = 서버 준비 전이라 기능 숨김)
  const [freeGiven, setFreeGiven] = useState<{ given: Map<string, number>; canChooseCount: boolean } | null>(null);
  const [freeCount, setFreeCount] = useState(1);
  const [granting, setGranting] = useState(false);
  // 회원: 이 파트너에게 쓸 수 있는 무료 이용권
  const [myFree, setMyFree] = useState({ free: 0, total: 0 });
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const [requesting, setRequesting] = useState(false);
  const purchasingRef = useRef(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // 파트너의 회원 탭 필터 (매칭 탭과 같은 필터)
  const memberFilter = useMemberFilter();
  // 회원이 보는 파트너 정보 (회원 구성·실적)
  const [overview, setOverview] = useState<any | null>(null);
  const [networkOverview, setNetworkOverview] = useState<any | null>(null);
  // 파트너 후기: 목록용 평균 별점 / 선택한 파트너의 후기 목록
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, ReviewSummary>>({});
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [tabStatus, setTabStatus] = useState<'pending' | 'approved' | 'ally'>('approved');
  // 동맹 연결자들이 승인한 회원 (동맹 매칭 전에 어떤 회원인지 확인용)
  const [allyMembers, setAllyMembers] = useState<any[]>([]);
  const [myCredit, setMyCredit] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState(PACKAGE_OPTIONS[0]);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    fetchConnectors();
  }, []);

  useFocusPolling(() => fetchConnectors(), 15000, !!user);
  const pullRefresh = usePullRefresh(() => fetchConnectors());

  // 초대 링크로 들어온 회원: 초대한 파트너 정보를 바로 열어 준다
  const params = useLocalSearchParams<{ open?: string; tab?: string }>();
  // 홈 '지금 할 일'의 가입 신청에서 들어오면 대기중 목록을 연다
  useEffect(() => {
    if (params.tab === 'pending' || params.tab === 'approved') {
      setTabStatus(params.tab);
      router.setParams({ tab: undefined });
    }
  }, [params.tab]);
  useEffect(() => {
    if (!params.open || user?.role !== 'hopeful' || loading) return;
    const target = connectors.find((c) => c.id === params.open);
    if (target) setSelectedConnector(target);
    router.setParams({ open: undefined });
  }, [params.open, loading, connectors]);

  async function fetchConnectors() {
    try {
      if (user?.role === 'connector') {
        // connector: 받은 요청 조회 (pending + approved). 같은 회원에 대한 중복 요청 행은 최신 것만 남긴다.
        const { data: dataRaw, error } = await supabase
          .from('hopeful_requests')
          .select('*')
          .eq('connector_id', user.id)
          .in('status', ['pending', 'approved'])
          .order('created_at', { ascending: false });

        if (error) throw error;

        const data = (dataRaw || []).filter(
          (req: any, index: number, arr: any[]) => arr.findIndex((r: any) => r.hopeful_id === req.hopeful_id) === index
        );

        // hopeful 정보 조회
        const hopefulIds = (data || []).map((req: any) => req.hopeful_id);
        const { data: hopefuls } = await supabase
          .from('users')
          .select('*')
          .in('id', hopefulIds);

        // 내 이용권(디파짓) 잔여 회차 조회 (회원 카드에 표시용)
        const { data: myPayments } = await supabase
          .from('payments')
          .select('hopeful_id, sessions_remaining')
          .eq('connector_id', user.id)
          .eq('status', 'paid')
          .in('hopeful_id', hopefulIds.length ? hopefulIds : ['00000000-0000-0000-0000-000000000000']);

        // 요청과 hopeful 정보를 합쳐서 표시
        const requests = (data || []).map((req: any) => {
          const hopeful = (hopefuls || []).find((h: any) => h.id === req.hopeful_id);
          const remainingCredit = (myPayments || [])
            .filter((p: any) => p.hopeful_id === req.hopeful_id)
            .reduce((sum: number, p: any) => sum + p.sessions_remaining, 0);
          return {
            id: req.hopeful_id,
            business_name: hopeful?.name || '사용자',
            verified: false,
            ...hopeful,
            request_id: req.id,
            request_status: req.status,
            remaining_credit: remainingCredit,
          };
        });
        setAllRequests(requests);
        await fetchAllyMembers();
        setConnectors(requests.filter(r => r.request_status === 'pending'));
      } else {
        // hopeful: 다른 connector들 조회 (승인된 연결자만)
        const { data: conData, error: conError } = await supabase
          .from('connectors')
          .select('*')
          .eq('status', 'approved');

        if (conError) throw conError;

        // connector 이름 정보 조회
        const connectorIds = (conData || []).map((c: any) => c.id);
        const { data: connUsers } = await supabase
          .from('users')
          .select('id, name, withdrawn_at, suspended_at, photo_urls')
          .in('id', connectorIds);

        // 내 요청 상태 (승인됨 / 승인 대기)
        const { data: myRequests } = await supabase
          .from('hopeful_requests')
          .select('connector_id, status')
          .eq('hopeful_id', user!.id)
          .in('status', ['approved', 'pending']);

        const approvedConnectorIds = (myRequests || []).filter((r: any) => r.status === 'approved').map((r: any) => r.connector_id);
        const pendingConnectorIds = (myRequests || []).filter((r: any) => r.status === 'pending').map((r: any) => r.connector_id);

        // 자신 제외 + 승인 여부 표시
        const filtered = (conData || []).map((conn: any) => {
          const connUser = (connUsers || []).find((u: any) => u.id === conn.id);
          return {
            ...conn,
            name: connUser?.name,
            partner_photo_urls: connUser?.photo_urls ?? [],
            is_approved: approvedConnectorIds.includes(conn.id),
            is_pending: pendingConnectorIds.includes(conn.id),
          };
        }).filter(conn => conn.id !== user?.id)
          // 탈퇴한 파트너는 목록에서 뺀다
          .filter((conn) => {
            const u = (connUsers || []).find((x: any) => x.id === conn.id);
            return !u?.withdrawn_at && !u?.suspended_at;
          });

        setConnectors(filtered);
        setReviewSummaries(await fetchReviewSummaries(filtered.map((c: any) => c.id)));
      }
    } catch (error) {
      console.error('Connectors error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllyMembers() {
    if (!user) return;
    const { data: allianceRows } = await supabase
      .from('connector_alliances')
      .select('connector_1_id, connector_2_id')
      .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
      .eq('status', 'ACTIVE');
    const allyIds = (allianceRows || []).map((a: any) => (a.connector_1_id === user.id ? a.connector_2_id : a.connector_1_id));
    if (allyIds.length === 0) {
      setAllyMembers([]);
      return;
    }

    const { data: reqRows } = await supabase
      .from('hopeful_requests')
      .select('hopeful_id, connector_id')
      .in('connector_id', allyIds)
      .eq('status', 'approved');
    // 같은 회원이 여러 번 요청했을 수 있으므로 회원 기준으로 하나만 남긴다
    const memberToConnector = new Map<string, string>();
    (reqRows || []).forEach((r: any) => {
      if (!memberToConnector.has(r.hopeful_id)) memberToConnector.set(r.hopeful_id, r.connector_id);
    });
    const memberIds = [...memberToConnector.keys()];
    if (memberIds.length === 0) {
      setAllyMembers([]);
      return;
    }

    const [{ data: members }, { data: allyUsers }] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, gender, age, photo_urls, height, location, job, education, bio, religion, smoking, drinking, body_type')
        .in('id', memberIds),
      supabase.from('users').select('id, name').in('id', allyIds),
    ]);
    setAllyMembers(
      (members || []).map((m: any) => ({
        ...m,
        business_name: m.name,
        verified: false,
        ally_connector_id: memberToConnector.get(m.id),
        ally_connector_name: (allyUsers || []).find((u: any) => u.id === memberToConnector.get(m.id))?.name || '동맹 파트너',
      }))
    );
  }

  // 파트너를 새로 열 때만 다시 불러온다 (같은 파트너의 요금만 바뀐 경우 고른 회차를 유지)
  const openedPartnerRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedConnector?.id ?? null;
    openedPartnerRef.current = id;
    if (user?.role !== 'connector' && id) {
      // 늦게 도착한 이전 파트너의 응답이 지금 파트너 정보를 덮어쓰지 않도록 확인한다
      const stillOpen = () => openedPartnerRef.current === id;
      setReviews(null);
      fetchConnectorReviews(id).then((r) => stillOpen() && setReviews(r));
      // 회원 구성·실적: 지금 실제 회원 기준으로 서버에서 계산
      setOverview(null);
      setNetworkOverview(null);
      supabase
        .rpc('fn_partner_overview', { p_connector_id: id, p_include_allies: false })
        .then(({ data, error }) => {
          if (error) console.error('partner overview error:', error);
          if (stillOpen()) setOverview(error ? { error: true } : data);
        });
      supabase
        .rpc('fn_partner_overview', { p_connector_id: id, p_include_allies: true })
        .then(({ data, error }) => stillOpen() && setNetworkOverview(error ? { error: true } : data));
    }

    if (user?.role !== 'connector' && id && selectedConnector?.is_approved) {
      setSelectedPackage(PACKAGE_OPTIONS[0]);
      getCredit(user!.id, id).then(({ credit }) => stillOpenCredit(id) && setMyCredit(credit));
      getFreeCredit(user!.id, id).then((n) => stillOpenCredit(id) && setMyFree(n));
    } else {
      setMyCredit(0);
      setMyFree({ free: 0, total: 0 });
    }
    if (user?.role === 'connector' && id) { setFreeCount(1); fetchFreeGiven(user.id).then(setFreeGiven); }
  }, [selectedConnector?.id, selectedConnector?.is_approved]);
  const stillOpenCredit = (id: string) => openedPartnerRef.current === id;

  async function handleGrantFree(member: { id: string; name: string }) {
    if (!user || granting) return;
    const count = freeGiven?.canChooseCount ? freeCount : 1;
    const ok = await confirm({
      title: `${member.name}님에게 무료 이용권 ${count}회를 줄까요?`,
      message: '회원 1명당 한 번만 줄 수 있고, 되돌릴 수 없어요.\n이 이용권으로 성사된 만남은 정산금이 없어요.',
      confirmText: '선물하기',
    });
    if (!ok) return;
    setGranting(true);
    const r = await grantFreeCredit(user.id, member.id, count);
    setGranting(false);
    if (r === 'ok') toast.show(`${member.name}님에게 무료 이용권 ${count}회를 선물했어요`, 'success');
    else if (r === 'already') toast.show('이미 무료 이용권을 준 회원이에요', 'info');
    else if (r === 'not_member') toast.show('내 회원에게만 줄 수 있어요', 'error');
    else if (r === 'bad_count') toast.show('한 번에 5회까지 줄 수 있어요', 'error');
    else if (r === 'inactive') toast.show('이용이 정지되었거나 탈퇴한 회원이에요', 'error');
    else toast.show('선물하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    fetchFreeGiven(user.id).then(setFreeGiven);
    fetchConnectors();
  }

  async function handlePurchase() {
    // 같은 화면에서 빠르게 두 번 눌러도 한 번만 결제되도록
    if (!user || !selectedConnector || purchasingRef.current) return;
    purchasingRef.current = true;
    setPurchasing(true);
    try {
      const result = await purchasePackage(user.id, selectedConnector.id, selectedPackage, selectedConnector.fee_per_session ?? 0);
      if (result.ok) {
        toast.show(`✓ ${selectedPackage}회 이용권을 구매했습니다`, 'success');
        const { credit } = await getCredit(user.id, selectedConnector.id);
        setMyCredit(credit);
      } else if (result.reason === 'insufficient') {
        // 잔액이 모자라면 충전 화면으로 바로 보낸다 (막다른 길 방지)
        toast.show(`충전된 금액이 ${(result.total! - result.balance!).toLocaleString()}원 부족해요. 충전 후 다시 결제해주세요`, 'error');
        setSelectedConnector(null);
        router.push({ pathname: '/profile', params: { open: 'credits' } });
      } else if (result.reason === 'fee_changed') {
        setSelectedConnector({ ...selectedConnector, fee_per_session: result.fee });
        toast.show(`파트너가 1회 비용을 ${result.fee!.toLocaleString()}원으로 바꿨어요. 금액을 확인하고 다시 결제해주세요`, 'error');
      } else if (result.reason === 'no_fee') {
        toast.show('파트너가 아직 비용을 정하지 않았어요. 채팅으로 문의해주세요', 'error');
      } else if (result.reason === 'not_member') {
        toast.show('가입 승인을 받은 파트너의 이용권만 구매할 수 있어요', 'error');
      } else {
        toast.show('결제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요', 'error');
      }
    } finally {
      purchasingRef.current = false;
      setPurchasing(false);
    }
  }

  async function handleRequest() {
    if (!selectedConnector || !user) return;

    setRequesting(true);
    try {
      const result = await requestJoin(user, selectedConnector.id);
      if (result === 'pending' || result === 'approved') {
        toast.show(result === 'pending' ? '이미 요청을 보냈어요. 파트너의 승인을 기다리는 중이에요' : '이미 승인된 파트너입니다', 'info');
        setSelectedConnector(null);
        return;
      }
      if (result === 'error') throw new Error('request failed');
      toast.show('가입을 요청했어요. 파트너가 승인하면 알려드릴게요', 'success');
      setSelectedConnector(null);
    } catch (error) {
      console.error('Request error:', error);
      toast.show('가입요청을 보내지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setRequesting(false);
    }
  }

  async function handleApprove(requestId: string, hopefulId: string) {
    setProcessingId(requestId);
    try {
      // 요청 승인
      const { error: updateError } = await supabase
        .from('hopeful_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);

      if (updateError) throw updateError;

      await createNotification({
        userId: hopefulId,
        type: 'signup_approved',
        title: '가입 요청이 승인되었습니다',
        body: `${user?.name}님이 가입 요청을 승인했습니다`,
        route: '/connectors',
      });

      toast.show('요청을 승인했습니다', 'success');
      fetchConnectors();
    } catch (error) {
      console.error('Approve error:', error);
      toast.show('승인하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(requestId: string, hopefulId: string) {
    setProcessingId(requestId);
    try {
      const { error } = await supabase
        .from('hopeful_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId);

      if (error) throw error;

      await createNotification({
        userId: hopefulId,
        type: 'signup_rejected',
        title: '가입 요청이 거절되었습니다',
        body: `${user?.name}님이 가입 요청을 거절했습니다`,
        route: '/connectors',
      });

      toast.show('요청을 거절했습니다', 'success');
      fetchConnectors();
    } catch (error) {
      console.error('Reject error:', error);
      toast.show('거절하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return <SkeletonScreen />;
  }

  // connector면 회원 관리 화면
  if (user?.role === 'connector') {
    const tabMembers = tabStatus === 'ally' ? allyMembers : allRequests.filter(r => r.request_status === tabStatus);
    const displayRequests = tabMembers.filter((m: any) => memberFilter.passes(m));
    const emptyText = {
      approved: '승인한 회원이 없습니다',
      pending: '대기 중인 요청이 없습니다',
      ally: '동맹 파트너의 회원이 없습니다.\n마이 › 동맹 관리에서 다른 파트너와 동맹을 맺어보세요.',
    }[tabStatus];

    return (
      <ScrollView style={styles.container} refreshControl={pullRefresh}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>회원</Text>
            <NotificationBell />
          </View>
        </View>

        <View style={styles.subTabContainer}>
          {([
            ['approved', `승인함 (${allRequests.filter(r => r.request_status === 'approved').length})`],
            ['pending', `대기중 (${allRequests.filter(r => r.request_status === 'pending').length})`],
            ['ally', `동맹 회원 (${allyMembers.length})`],
          ] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.subTab, tabStatus === key && styles.activeSubTab]}
              onPress={() => setTabStatus(key)}
            >
              <Text style={[styles.subTabText, tabStatus === key && styles.activeSubTabText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tabMembers.length > 0 && <View style={styles.filterWrap}>{memberFilter.render(tabMembers)}</View>}

        {tabStatus === 'ally' && allyMembers.length > 0 && (
          <Text style={styles.allyHint}>매칭 탭에서 '동맹 회원 포함'을 켜면 내 회원과 매칭을 제안할 수 있어요</Text>
        )}

        {displayRequests.length === 0 ? (
          <View style={styles.emptyTab}>
            <Text style={[styles.placeholderText, { textAlign: 'center', lineHeight: 20 }]}>
              {tabMembers.length > 0 ? '조건에 맞는 회원이 없습니다' : emptyText}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayRequests}
            keyExtractor={(item, index) => item.request_id || `${item.id}-${index}`}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <TouchableOpacity style={{flex: 1}} onPress={() => setSelectedConnector(item)} activeOpacity={0.7}>
                  <View style={styles.connTop}>
                    <Avatar photoUrls={item.photo_urls} size={44} />
                    <View style={styles.connInfo}>
                      <Text style={styles.name}>
                        {item.business_name}
                        {!!(item as any).suspended_at && <Text style={styles.suspendedTag}>  이용 정지</Text>}
                      </Text>
                      <Text style={styles.desc}>
                        {tabStatus === 'ally'
                          ? [item.ally_connector_name + ' 소속', item.gender === 'M' ? '남' : item.gender === 'F' ? '여' : null, item.age && `${item.age}세`, item.location].filter(Boolean).join(' · ')
                          : [item.gender === 'M' ? '남' : item.gender === 'F' ? '여' : null, item.age && `${item.age}세`, item.location].filter(Boolean).join(' · ') || (tabStatus === 'pending' ? '가입 요청' : '내 회원')}
                      </Text>
                    </View>
                    {tabStatus !== 'ally' && (
                      <View style={styles.creditPill}>
                        <Text style={styles.creditPillText}>남은 이용권 {item.remaining_credit || 0}회</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                {tabStatus === 'pending' && (
                  <View style={styles.meta}>
                    <TouchableOpacity
                      style={[styles.approveBtn, processingId === item.request_id && styles.buttonDisabled]}
                      onPress={() => handleApprove(item.request_id, item.id)}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.approveBtnText}>{processingId === item.request_id ? '처리 중...' : '승인'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rejectBtn, processingId === item.request_id && styles.buttonDisabled]}
                      onPress={() => handleReject(item.request_id, item.id)}
                      disabled={processingId !== null}
                    >
                      <Text style={styles.rejectBtnText}>{processingId === item.request_id ? '처리 중...' : '거절'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {tabStatus === 'ally' && !!item.ally_connector_id && (
                  <View style={styles.meta}>
                    <Text style={styles.desc}>담당 {item.ally_connector_name}</Text>
                    <TouchableOpacity
                      style={styles.chatShortcutBtn}
                      onPress={() => router.push({ pathname: '/chat', params: { with: item.ally_connector_id, name: item.ally_connector_name } })}
                      accessibilityLabel={`${item.ally_connector_name} 파트너와 채팅`}
                    >
                      <Text style={styles.chatShortcutBtnText}>💬 파트너 채팅</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {tabStatus === 'approved' && (
                  <View style={styles.meta}>
                    <Text style={styles.approvedStatusBadge}>✓ 승인됨</Text>
                    <TouchableOpacity
                      style={styles.chatShortcutBtn}
                      onPress={() => router.push({ pathname: '/chat', params: { with: item.id, name: item.business_name } })}
                    >
                      <Text style={styles.chatShortcutBtnText}>💬 채팅</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            scrollEnabled={false}
            contentContainerStyle={styles.list}
          />
        )}

        {/* Connector 바텀시트 */}
        {selectedConnector && user?.role === 'connector' && (
          <BottomSheet visible onClose={() => setSelectedConnector(null)} title="회원 프로필">
                <View>
                  {selectedConnector && <MemberProfileView member={selectedConnector} showBirthDate />}
                  {(tabStatus === 'approved' || (tabStatus === 'ally' && !!selectedConnector?.ally_connector_id)) && (
                    <TouchableOpacity
                      style={styles.proposeBtn}
                      onPress={() => {
                        const c = selectedConnector;
                        setSelectedConnector(null);
                        router.push({ pathname: '/matching', params: { pick: c.id, pickFrom: tabStatus === 'ally' ? c.ally_connector_id : user!.id } });
                      }}
                      accessibilityLabel="이 회원으로 매칭 제안하기"
                    >
                      <Text style={styles.proposeBtnText}>이 회원으로 매칭 제안하기</Text>
                    </TouchableOpacity>
                  )}
                  {tabStatus === 'ally' && !!selectedConnector?.ally_connector_id && (
                    <TouchableOpacity
                      style={styles.allyChatBtn}
                      onPress={() => {
                        const c = selectedConnector;
                        setSelectedConnector(null);
                        router.push({ pathname: '/chat', params: { with: c.ally_connector_id, name: c.ally_connector_name } });
                      }}
                      accessibilityLabel="담당 파트너와 채팅"
                    >
                      <Text style={styles.allyChatBtnText}>💬 담당 파트너({selectedConnector.ally_connector_name})와 채팅</Text>
                    </TouchableOpacity>
                  )}
                  {tabStatus === 'approved' && freeGiven && (
                    freeGiven.given.has(selectedConnector.id) ? (
                      <Text style={styles.freeGiven}>🎁 무료 이용권 {freeGiven.given.get(selectedConnector.id)}회를 선물했어요</Text>
                    ) : (
                      <View style={styles.freeBox}>
                        <Text style={styles.freeTitle}>🎁 무료 이용권 선물</Text>
                        {freeGiven.canChooseCount && (
                          <View style={styles.freeChips}>
                            {FREE_COUNT_OPTIONS.map((n) => (
                              <TouchableOpacity
                                key={n}
                                style={[styles.freeChip, freeCount === n && styles.freeChipOn]}
                                onPress={() => setFreeCount(n)}
                                accessibilityLabel={`무료 이용권 ${n}회`}
                                accessibilityState={{ selected: freeCount === n }}
                              >
                                <Text style={[styles.freeChipText, freeCount === n && styles.freeChipTextOn]}>{n}회</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                        <TouchableOpacity
                          style={[styles.freeBtn, granting && styles.buttonDisabled]}
                          onPress={() => handleGrantFree({ id: selectedConnector.id, name: selectedConnector.business_name || selectedConnector.name || '회원' })}
                          disabled={granting}
                          accessibilityLabel={`무료 이용권 ${freeGiven.canChooseCount ? freeCount : 1}회 주기`}
                        >
                          {granting ? <ActivityIndicator color="#5B21FF" /> : <Text style={styles.freeBtnText}>무료 이용권 {freeGiven.canChooseCount ? freeCount : 1}회 주기</Text>}
                        </TouchableOpacity>
                        <Text style={styles.freeBtnSub}>회원 1명당 한 번 · 이 이용권으로 성사된 만남은 정산금 없음</Text>
                      </View>
                    )
                  )}
                </View>
          </BottomSheet>
        )}

      </ScrollView>
    );
  }

  // 회원 구성 그래프 (내 회원 / 동맹 포함 공용)
  const query = search.trim();
  const visiblePartners = query
    ? connectors.filter((c) => [c.business_name, formatRegions(c.main_region), partnerIntro(c)].some((v) => v?.includes(query)))
    : connectors;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>매칭 파트너</Text>
          <NotificationBell />
        </View>
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="🔍 회사명, 지역, 서비스로 찾기"
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        data={visiblePartners}
        ListEmptyComponent={
          <View style={styles.emptyTab}>
            <Text style={styles.placeholderText}>{search ? '찾는 파트너가 없습니다' : '아직 등록된 파트너가 없습니다'}</Text>
          </View>
        }
        keyExtractor={(item) => item.id}
        refreshControl={pullRefresh}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, item.is_approved && styles.approvedCard]}
            onPress={() => setSelectedConnector(item)}
          >
            <View style={styles.connTop}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>💼</Text>
              </View>
              <View style={styles.connInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{item.business_name}</Text>
                  {item.verified && <View style={styles.badge}><Text style={styles.badgeText}>인증</Text></View>}
                  {item.is_approved && <View style={styles.approvedBadge}><Text style={styles.approvedBadgeText}>✓ 승인됨</Text></View>}
                </View>
                <Text style={styles.desc}>파트너</Text>
              </View>
            </View>
            <View style={styles.meta}>
              <Text style={styles.price}>{item.fee_per_session ? `${item.fee_per_session.toLocaleString()}원 / 건` : '-'}</Text>
              {!!reviewSummaries[item.id] && (
                <Text style={styles.reviewScore}>★ {reviewSummaries[item.id].avg.toFixed(1)} ({reviewSummaries[item.id].count})</Text>
              )}
              {!!item.main_region && <Text style={styles.rating}>{formatRegions(item.main_region)}</Text>}
            </View>
          </TouchableOpacity>
        )}
        scrollEnabled={false}
        contentContainerStyle={styles.list}
      />

      <BottomSheet visible={selectedConnector !== null} onClose={() => setSelectedConnector(null)} title="파트너 정보">
            <View>
              {selectedConnector && (
                <>
                  <>
                    <View style={styles.modalHeader}>
                      <Avatar photoUrls={selectedConnector.partner_photo_urls} size={80} />
                      <Text style={styles.modalTitle}>{selectedConnector.business_name}</Text>
                      <Text style={styles.partnerSub}>
                        {selectedConnector.name ? `${selectedConnector.name} 파트너` : '파트너'}
                        {selectedConnector.verified ? ' · ✓ 인증' : ''}
                      </Text>
                    </View>

                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>파트너 소개</Text>
                      {selectedConnector.career || partnerIntro(selectedConnector) ? (
                        <>
                          {!!selectedConnector.career && <Text style={styles.careerText}>경력 · {selectedConnector.career}</Text>}
                          {!!partnerIntro(selectedConnector) && <Text style={styles.bioText}>{partnerIntro(selectedConnector)}</Text>}
                        </>
                      ) : (
                        <Text style={styles.bioText}>아직 소개를 작성하지 않았어요. 궁금한 점은 채팅으로 물어보세요.</Text>
                      )}
                    </View>

                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>기본정보</Text>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>소개 지역</Text>
                        <Text style={styles.infoValue}>{formatRegions(selectedConnector.main_region) || '-'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>1회 소개 비용</Text>
                        <Text style={styles.infoValue}>{selectedConnector.fee_per_session ? `${selectedConnector.fee_per_session.toLocaleString()}원` : '-'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>성사된 만남</Text>
                        <Text style={styles.infoValue}>{overview && !overview.error ? `${overview.settled}건` : '-'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>애프터로 이어진 만남</Text>
                        <Text style={styles.infoValue}>{overview && !overview.error ? `${overview.mutual}건` : '-'}</Text>
                      </View>
                    </View>

                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>회원 구성</Text>
                      {overview === null ? (
                        <ActivityIndicator color="#5B21FF" />
                      ) : overview.error ? (
                        <Text style={styles.bioText}>회원 구성을 불러오지 못했어요</Text>
                      ) : (
                        <PartnerComposition ov={overview} />
                      )}
                    </View>

                    {/* 동맹 매칭으로 동맹 파트너의 회원과도 만날 수 있다 */}
                    {networkOverview && !networkOverview.error && networkOverview.ally_count > 0 && (
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>동맹 포함 회원 구성</Text>
                        <Text style={styles.distHint}>
                          동맹 파트너 {networkOverview.ally_count}곳의 회원까지 포함해요. 동맹 매칭으로 이 회원들과도 만날 수 있어요.
                        </Text>
                        <PartnerComposition ov={networkOverview} />
                      </View>
                    )}


                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>후기</Text>
                      <ReviewList reviews={reviews} />
                    </View>

                    {selectedConnector.is_approved ? (
                      <View style={styles.modalSection}>
                        <View style={styles.approvedStatus}>
                          <Text style={styles.approvedStatusText}>✓ 이미 승인된 파트너입니다</Text>
                        </View>

                        <TouchableOpacity
                          style={styles.chatShortcutBtnWide}
                          onPress={() => {
                            setSelectedConnector(null);
                            router.push({ pathname: '/chat', params: { with: selectedConnector.id, name: selectedConnector.business_name } });
                          }}
                        >
                          <Text style={styles.chatShortcutBtnWideText}>💬 채팅하기</Text>
                        </TouchableOpacity>

                        <Text style={styles.modalSectionTitle}>이용권 구매</Text>
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>사용할 수 있는 이용권</Text>
                          <Text style={styles.infoValue}>{myCredit}회{freeWithinAvailable(myFree.free, myFree.total, myCredit) > 0 ? ` (무료 ${freeWithinAvailable(myFree.free, myFree.total, myCredit)}회 포함)` : ''}</Text>
                        </View>

                        <View style={styles.buttonGroup}>
                          {PACKAGE_OPTIONS.map((count) => (
                            <TouchableOpacity
                              key={count}
                              style={[styles.optionBtn, selectedPackage === count && styles.optionBtnSelected]}
                              onPress={() => setSelectedPackage(count)}
                            >
                              <Text style={[styles.optionBtnText, selectedPackage === count && styles.optionBtnTextSelected]}>
                                {count}회
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        <Text style={styles.packagePrice}>
                          {((selectedConnector.fee_per_session || 0) * selectedPackage).toLocaleString()}원
                        </Text>

                        <TouchableOpacity
                          style={[styles.contactBtn, purchasing && styles.buttonDisabled]}
                          onPress={handlePurchase}
                          disabled={purchasing}
                        >
                          <Text style={styles.contactBtnText}>{purchasing ? '결제 중...' : '결제하기'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View>
                        {/* 가입 전에 궁금한 점을 먼저 물어볼 수 있다 (보조 버튼) */}
                        <TouchableOpacity
                          style={styles.chatShortcutBtnWide}
                          onPress={() => {
                            setSelectedConnector(null);
                            router.push({ pathname: '/chat', params: { with: selectedConnector.id, name: selectedConnector.business_name } });
                          }}
                        >
                          <Text style={styles.chatShortcutBtnWideText}>💬 궁금한 점 채팅으로 물어보기</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.contactBtn, (requesting || selectedConnector.is_pending) && styles.buttonDisabled]}
                          onPress={handleRequest}
                          disabled={requesting || selectedConnector.is_pending}
                        >
                          {requesting ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.contactBtnText}>
                              {selectedConnector.is_pending ? '가입요청 보냄 · 승인을 기다리는 중' : '가입요청'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
              </>
            )}
            {selectedConnector && (
              <SafetyActions targetId={selectedConnector.id} targetName={selectedConnector.business_name || selectedConnector.name || '파트너'} context="partner" />
            )}
            </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  proposeBtn: { marginTop: 16, minHeight: 50, borderRadius: 12, backgroundColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  proposeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  allyChatBtn: { marginTop: 10, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#5B21FF', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  allyChatBtnText: { color: '#5B21FF', fontSize: 15, fontWeight: '700' },
  freeBox: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#F7F7F9' },
  freeTitle: { fontSize: 15, fontWeight: '700', color: '#191919' },
  freeChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  freeChip: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E6', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  freeChipOn: { borderColor: '#5B21FF', backgroundColor: '#F4F1FF' },
  freeChipText: { fontSize: 15, color: '#555' },
  freeChipTextOn: { color: '#5B21FF', fontWeight: '700' },
  freeBtn: { borderWidth: 1, borderColor: '#5B21FF', backgroundColor: '#fff', borderRadius: 12, minHeight: 48, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  freeBtnText: { fontSize: 15, fontWeight: '700', color: '#5B21FF' },
  freeBtnSub: { fontSize: 12, color: '#888', marginTop: 8, textAlign: 'center' },
  freeGiven: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 16 },
  suspendedTag: { fontSize: 12, color: '#E53935', fontWeight: '600' },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  searchInput: {
    fontSize: 14,
    color: '#333',
    paddingVertical: 2,
  },
  searchBar: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  connTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  creditPill: {
    backgroundColor: '#F1ECFF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  creditPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5B21FF',
  },
  chatShortcutBtn: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chatShortcutBtnWide: {
    backgroundColor: '#F1ECFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  chatShortcutBtnWideText: {
    color: '#5B21FF',
    fontSize: 14,
    fontWeight: '700',
  },
  chatShortcutBtnText: {
    color: '#5B21FF',
    fontSize: 12,
    fontWeight: '600',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F1ECFF',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: 20,
  },
  avatarText: {
    fontSize: 20,
  },
  connInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  name: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  badge: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    backgroundColor: '#5B21FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  desc: {
    fontSize: 11,
    color: '#999',
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 11,
  },
  price: {
    fontSize: 12,
    fontWeight: '800',
    color: '#333',
  },
  rating: {
    color: '#999',
  },
  partnerSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  careerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  distBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  distLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
  },
  distHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
    lineHeight: 18,
  },
  reviewScore: {
    color: '#333',
    fontWeight: '600',
  },
  bottomSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
  },
  modalContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalClose: {
    alignSelf: 'flex-end',
    padding: 10,
    marginBottom: 10,
  },
  modalCloseText: {
    fontSize: 24,
    color: '#999',
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 30,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginTop: 12,
  },
  modalSection: {
    marginBottom: 30,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 13,
    color: '#666',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  contactBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  contactBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  approvedStatus: {
    backgroundColor: '#F1ECFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#5B21FF',
  },
  approvedStatusText: {
    color: '#5B21FF',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  approveBtn: {
    backgroundColor: '#5B21FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  rejectBtn: {
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  rejectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  bioText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
  modalButtonGroup: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    marginBottom: 40,
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  optionBtn: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  optionBtnSelected: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  optionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  optionBtnTextSelected: {
    color: '#fff',
  },
  packagePrice: {
    fontSize: 18,
    fontWeight: '800',
    color: '#5B21FF',
    textAlign: 'right',
    marginTop: 12,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  activeTab: {
    borderBottomColor: '#5B21FF',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  activeTabText: {
    color: '#5B21FF',
  },
  allyHint: {
    fontSize: 12,
    color: '#888',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  emptyTab: {
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: '#999',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
  },
  approvedStatusBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5B21FF',
  },
  filterWrap: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  subTabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  subTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
  },
  activeSubTab: {
    borderBottomColor: '#5B21FF',
  },
  subTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
  },
  activeSubTabText: {
    color: '#5B21FF',
  },
  approvedCard: {
    backgroundColor: '#F1ECFF',
    borderLeftColor: '#5B21FF',
    borderLeftWidth: 3,
  },
  approvedBadge: {
    backgroundColor: '#5B21FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  approvedBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  matchTimelineCard: {
    backgroundColor: '#F1ECFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    marginHorizontal: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  matchTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  matchDate: {
    fontSize: 11,
    color: '#999',
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  timelineCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 2,
  },
  timelineComplete: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  timelinePending: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  timelineIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5B21FF',
  },
  timelineLabel: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
  },
  timelineLine: {
    height: 2,
    flex: 1,
    backgroundColor: '#ddd',
    marginBottom: 20,
  },
});
