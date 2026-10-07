import React, { useState, useEffect, useCallback } from 'react';
import BusinessSettingsSheet from '@/components/BusinessSettingsSheet';
import WatermarkLookupSheet from '@/components/WatermarkLookupSheet';
import BusinessInfo from '@/components/BusinessInfo';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getMyConnectorCredits, chargeWallet, getWalletBalance, CHARGE_OPTIONS } from '@/lib/payments';
import NotificationBell from '@/components/NotificationBell';
import BottomSheet from '@/components/BottomSheet';
import PhotoEditor from '@/components/PhotoEditor';
import { Avatar } from '@/components/ProfilePhoto';
import ReviewList from '@/components/ReviewList';
import TermsSheet from '@/components/TermsSheet';
import BlockListSheet from '@/components/BlockListSheet';
import InviteSheet from '@/components/InviteSheet';
import ConsentChecklist, { ConsentItem } from '@/components/ConsentChecklist';
import { recordConsents, TermsDocKey } from '@/lib/terms';
import { getPendingRefund, getRefundable, Refundable, requestRefund, withdrawAccount } from '@/lib/refunds';
import { createNotification } from '@/lib/notifications';
import { findBannedWord } from '@/lib/adPolicy';

const PARTNER_CONSENTS: ConsentItem[] = [{ key: 'partner', label: '매칭 파트너 이용약관 동의', doc: 'partner' }];
import { fetchConnectorReviews, Review } from '@/lib/reviews';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUser, refreshUser } = useAuth();

  // 파트너 승인 등 역할 변경을 바로 반영한다
  useFocusEffect(
    useCallback(() => {
      if (user) refreshUser(user.id);
    }, [user?.id])
  );
  const toast = useToast();
  const confirm = useConfirm();
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [partnerConsents, setPartnerConsents] = useState<string[]>([]);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showBusiness, setShowBusiness] = useState(false);
  const [showWatermark, setShowWatermark] = useState(false);
  // 소개 글 검수 상태 (승인본과 검수 대기본). reviewReady=false 면 검수용 DB 컬럼이 아직 없음 → 예전처럼 바로 저장
  const [profileReview, setProfileReview] = useState<{ status: string; reason: string | null; approved: { career: string; intro: string; service_description: string }; pending: { career?: string; intro?: string; service_description?: string } | null; reviewReady: boolean }>({
    status: 'APPROVED', reason: null, approved: { career: '', intro: '', service_description: '' }, pending: null, reviewReady: false,
  });
  // 프로필을 다 불러오기 전에 저장하면 빈 값으로 덮어쓰므로, 불러온 뒤에만 저장할 수 있다
  const [profileLoaded, setProfileLoaded] = useState(false);
  // 마이 하단에서 여는 약관 전문
  const [viewingTerms, setViewingTerms] = useState<TermsDocKey | null>(null);
  const [connectorApplicationStatus, setConnectorApplicationStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  // 환불
  const [refundable, setRefundable] = useState<Refundable | null>(null);
  const [pendingRefund, setPendingRefund] = useState<any | null>(null);
  const [showRefundSheet, setShowRefundSheet] = useState(false);
  const [refundBank, setRefundBank] = useState({ bankName: '', accountNumber: '', accountHolder: '' });
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showSettlementsModal, setShowSettlementsModal] = useState(false);
  const [showCreditScoreModal, setShowCreditScoreModal] = useState(false);
  // 회원이 남긴 내 후기 (연결자)
  const [showReviewsSheet, setShowReviewsSheet] = useState(false);
  const [myReviews, setMyReviews] = useState<Review[] | null>(null);
  const [creditScore, setCreditScore] = useState<any | null>(null);
  const [loadingCreditScore, setLoadingCreditScore] = useState(false);
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [savingBank, setSavingBank] = useState(false);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [myWithdrawals, setMyWithdrawals] = useState<any[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [requestingWithdrawal, setRequestingWithdrawal] = useState(false);
  const [loadingBank, setLoadingBank] = useState(false);
  const [mySettlements, setMySettlements] = useState<any[]>([]);
  const [loadingSettlements, setLoadingSettlements] = useState(false);
  const [myConnectorCredits, setMyConnectorCredits] = useState<any[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [chargeAmount, setChargeAmount] = useState(CHARGE_OPTIONS[0]);
  const [charging, setCharging] = useState(false);
  const [profileData, setProfileData] = useState({
    location: '',
    height: '',
    job: '',
    education: '',
    bio: '',
    religion: '',
    smoking: '',
    drinking: '',
    body_type: '',
  });
  const [storeData, setStoreData] = useState({
    male_count: 0,
    female_count: 0,
    matching_count: 0,
    main_region: '',
    fee_per_session: '',
    service_description: '',
    intro: '',
    career: '',
  });
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  const locations = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주'];

  useEffect(() => {
    if (!user) return;
    supabase.from('users').select('photo_urls').eq('id', user.id).maybeSingle().then(({ data }) => {
      setPhotoUrls(data?.photo_urls ?? []);
    });
  }, [user?.id]);

  // 홈의 '남은 이용권'에서 들어오면 이용권 시트를 바로 연다
  const { open } = useLocalSearchParams<{ open?: string }>();
  useEffect(() => {
    if (open === 'credits') {
      setShowCreditsModal(true);
      router.setParams({ open: undefined });
    } else if (open === 'profile') {
      setShowProfileModal(true);
      router.setParams({ open: undefined });
    }
  }, [open]);

  useEffect(() => {
    if (showCreditScoreModal && user) {
      setLoadingCreditScore(true);
      supabase.rpc('fn_get_credit_score', { p_connector_id: user.id }).then(({ data, error }) => {
        if (!error && data) {
          setCreditScore(data);
          if (data.grade && data.grade !== user.grade) {
            supabase.from('users').update({ grade: data.grade }).eq('id', user.id).then(() => {
              updateUser({ grade: data.grade });
            });
          }
        }
        setLoadingCreditScore(false);
      });
    }
  }, [showCreditScoreModal]);

  useEffect(() => {
    if (showProfileModal && user) {
      loadProfile();
    }
  }, [showProfileModal]);

  useEffect(() => {
    if (showBankModal && user) {
      loadBankInfo();
    }
  }, [showBankModal]);

  useEffect(() => {
    if (showConnectorModal && user) {
      supabase.from('connectors').select('status').eq('id', user.id).maybeSingle().then(({ data }) => {
        setConnectorApplicationStatus(data?.status || null);
      });
    }
  }, [showConnectorModal]);

  useEffect(() => {
    if (showStoreModal) {
      loadStoreStats();
    } else {
      setSelectedRegions([]);
    }
  }, [showStoreModal]);

  useEffect(() => {
    if (showCreditsModal && user) {
      loadMyCredits();
    }
  }, [showCreditsModal]);

  useEffect(() => {
    if (showSettlementsModal && user) {
      loadMySettlements();
    }
  }, [showSettlementsModal]);

  async function loadMySettlements() {
    if (!user) return;
    setLoadingSettlements(true);
    try {
      const { data: settlements, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('connector_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const hopefulIds = [...new Set((settlements || []).map((s: any) => s.hopeful_id))];
      const { data: hopefulUsers } = await supabase
        .from('users')
        .select('id, name')
        .in('id', hopefulIds.length ? hopefulIds : ['00000000-0000-0000-0000-000000000000']);

      const enriched = (settlements || []).map((s: any) => ({
        ...s,
        hopefulName: (hopefulUsers || []).find((u: any) => u.id === s.hopeful_id)?.name || '회원',
      }));

      setMySettlements(enriched);
    } catch (error) {
      console.error('내 정산 내역 조회 오류:', error);
    } finally {
      setLoadingSettlements(false);
    }
  }

  async function loadMyCredits() {
    if (!user) return;
    setLoadingCredits(true);
    try {
      const [{ data: credits, error }, { balance }, refundableNow, pending] = await Promise.all([
        getMyConnectorCredits(user.id),
        getWalletBalance(user.id),
        getRefundable(user.id),
        getPendingRefund(user.id),
      ]);
      if (error) throw error;
      setRefundable(refundableNow);
      setPendingRefund(pending);

      setMyConnectorCredits(credits);
      setWalletBalance(balance);
    } catch (error) {
      console.error('내 이용권 조회 오류:', error);
    } finally {
      setLoadingCredits(false);
    }
  }

  async function handleCharge() {
    if (!user) return;
    setCharging(true);
    try {
      const { error } = await chargeWallet(user.id, chargeAmount);
      if (error) throw error;
      toast.show(`✓ ${chargeAmount.toLocaleString()}원 충전했습니다`, 'success');
      await loadMyCredits();
    } catch (error: any) {
      console.error('충전 오류:', error);
      toast.show(error?.message || '충전 중 오류가 발생했습니다', 'error');
    } finally {
      setCharging(false);
    }
  }

  async function loadStoreStats() {
    if (!user) return;
    try {
      // 저장된 지역 로드
      // 검수 컬럼이 있으면 함께 읽고, 없으면(SQL 실행 전) 예전 컬럼만 읽는다
      let reviewReady = true;
      let { data: connectorData, error: cErr } = await supabase
        .from('connectors')
        .select('main_region, fee_per_session, service_description, intro, career, pending_profile, profile_status, profile_reject_reason')
        .eq('id', user.id)
        .single();
      // 검수 칸이 없을 때(SQL 실행 전)만 예전 방식으로. 일시적인 오류로 검수를 건너뛰지 않는다
      if (cErr && !['42703', 'PGRST204'].includes((cErr as any).code)) throw cErr;
      if (cErr) {
        reviewReady = false;
        ({ data: connectorData } = await supabase
          .from('connectors')
          .select('main_region, fee_per_session, service_description, intro, career')
          .eq('id', user.id)
          .single());
      }
      // 회원에게 보이는 대표 사진
      const { data: me } = await supabase.from('users').select('photo_urls').eq('id', user.id).maybeSingle();
      setPhotoUrls(me?.photo_urls ?? []);

      if (connectorData) {
        try {
          const regions = connectorData.main_region ? JSON.parse(connectorData.main_region) : [];
          setSelectedRegions(Array.isArray(regions) ? regions : []);
        } catch {
          setSelectedRegions([]);
        }
        const approved = {
          career: connectorData.career || '',
          intro: connectorData.intro || '',
          service_description: connectorData.service_description || '',
        };
        // 검수 대기(또는 반려된) 수정본이 있으면 입력칸에는 그것을 보여준다
        const pending = (connectorData as any).pending_profile as Partial<typeof approved> | null;
        setProfileReview({
          status: (connectorData as any).profile_status || 'APPROVED',
          reason: (connectorData as any).profile_reject_reason || null,
          approved,
          pending,
          reviewReady,
        });
        setStoreData((prev) => ({
          ...prev,
          main_region: connectorData.main_region || '',
          fee_per_session: connectorData.fee_per_session || '',
          service_description: pending?.service_description ?? approved.service_description,
          intro: pending?.intro ?? approved.intro,
          career: pending?.career ?? approved.career,
        }));
      }

      // 승인된 회원 수 계산
      const { data: hopefulRequests } = await supabase
        .from('hopeful_requests')
        .select('hopeful_id')
        .eq('connector_id', user.id)
        .eq('status', 'approved');

      if (hopefulRequests && hopefulRequests.length > 0) {
        const hopefulIds = hopefulRequests.map((r: any) => r.hopeful_id);
        const { data: hopefuls } = await supabase
          .from('users')
          .select('gender')
          .in('id', hopefulIds);

        const males = (hopefuls || []).filter((h: any) => h.gender === 'M').length;
        const females = (hopefuls || []).filter((h: any) => h.gender === 'F').length;

        setStoreData((prev) => ({...prev, male_count: males, female_count: females}));
      } else {
        setStoreData((prev) => ({...prev, male_count: 0, female_count: 0}));
      }

      // 매칭 수: 정상 마무리(정산)된 매칭 (노쇼 종료 제외) - 회원에게 보이는 파트너 정보와 같은 기준
      const { data: completedMatches } = await supabase
        .from('match_requests')
        .select('id')
        .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
        .eq('settlement_completed', true)
        .is('closed_reason', null);

      setStoreData((prev) => ({...prev, matching_count: (completedMatches || []).length}));
    } catch (error) {
      console.error('Error loading store stats:', error);
    }
  }
  const educations = ['고졸', '대졸', '대학원졸'];
  const religions = ['기독교', '천주교', '불교', '무교'];
  const smokings = ['비흡연', '흡연', '가끔'];
  const drinkings = ['비음주', '가끔', '자주'];
  const bodyTypes = ['마름', '보통', '통통', '근육질'];

  async function loadProfile() {
    setProfileLoaded(false);
    const { data, error } = await supabase
      .from('users')
      .select('location, height, job, education, bio, religion, smoking, drinking, body_type, photo_urls')
      .eq('id', user!.id)
      .maybeSingle();
    if (error || !data) return;
    setPhotoUrls(data.photo_urls ?? []);
    setProfileData({
      location: data.location ?? '',
      height: data.height != null ? String(data.height) : '',
      job: data.job ?? '',
      education: data.education ?? '',
      bio: data.bio ?? '',
      religion: data.religion ?? '',
      smoking: data.smoking ?? '',
      drinking: data.drinking ?? '',
      body_type: data.body_type ?? '',
    });
    setProfileLoaded(true);
  }

  async function handleProfileSave() {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          location: profileData.location,
          height: parseInt(profileData.height) || null,
          job: profileData.job,
          education: profileData.education,
          bio: profileData.bio,
          religion: profileData.religion,
          smoking: profileData.smoking,
          drinking: profileData.drinking,
          body_type: profileData.body_type,
        })
        .eq('id', user!.id);

      if (error) throw error;

      toast.show('프로필이 저장되었습니다', 'success');
      setShowProfileModal(false);
    } catch (error) {
      console.error('Profile save error:', error);
      toast.show('프로필 저장 실패', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleStoreSave() {
    if (selectedRegions.length === 0) {
      toast.show('주요지역을 선택해주세요', 'info');
      return;
    }

    const text = {
      career: storeData.career.trim(),
      intro: storeData.intro.trim(),
      service_description: storeData.service_description.trim(),
    };
    const base = {
      main_region: JSON.stringify(selectedRegions),
      fee_per_session: parseInt(storeData.fee_per_session) || null,
    };
    const ap = profileReview.approved;
    const textChanged = text.career !== ap.career.trim() || text.intro !== ap.intro.trim() || text.service_description !== ap.service_description.trim();
    const pv = profileReview.pending;
    const samePending = !!pv && (pv.career ?? '') === text.career && (pv.intro ?? '') === text.intro && (pv.service_description ?? '') === text.service_description;
    // 반려된 글을 그대로 둔 채 지역·금액만 바꾼 경우: 글은 다시 보내지 않는다
    const resubmitRejected = profileReview.status === 'REJECTED' && samePending;

    // 거짓·과장 광고가 될 수 있는 표현은 저장하지 않는다 (바뀐 글만 검사: 예전에 승인된 글 때문에 금액 저장이 막히지 않게)
    const banned = textChanged && !resubmitRejected ? findBannedWord(text.career, text.intro, text.service_description) : null;
    if (banned) {
      toast.show(`'${banned}' 같은 표현은 쓸 수 없어요 (과장 광고 방지). 다른 표현으로 바꿔주세요`, 'error');
      return;
    }

    setLoading(true);
    try {
      let sentForReview = false;
      if (profileReview.reviewReady) {
        // 소개 글이 바뀌었으면 검수 대기로 보내고, 승인 전까지 회원에게는 이전 승인본이 보인다
        const update: Record<string, any> = { ...base };
        if (resubmitRejected) {
          // 반려 상태 유지 (글은 그대로)
        } else if (textChanged) {
          Object.assign(update, { pending_profile: text, profile_status: 'PENDING', profile_reject_reason: null });
        } else if (profileReview.status !== 'APPROVED') {
          // 승인본과 같게 되돌렸다면 대기본을 지운다
          Object.assign(update, { pending_profile: null, profile_status: 'APPROVED', profile_reject_reason: null });
        }
        const { error } = await supabase.from('connectors').update(update).eq('id', user!.id);
        if (error) throw error;
        // 같은 내용으로 다시 저장한 경우에는 운영자에게 또 알리지 않는다
        sentForReview = textChanged && !samePending;
        if (!resubmitRejected) {
          setProfileReview((r) => ({
            ...r,
            status: textChanged ? 'PENDING' : 'APPROVED',
            reason: null,
            pending: textChanged ? text : null,
          }));
        }
      } else {
        // 검수 컬럼이 아직 없으면 예전처럼 바로 저장
        const { error } = await supabase
          .from('connectors')
          .update({ ...base, career: text.career || null, intro: text.intro || null, service_description: text.service_description })
          .eq('id', user!.id);
        if (error) throw error;
      }

      if (resubmitRejected && profileReview.reviewReady) {
        toast.show('지역·금액을 저장했어요. 반려된 소개 글은 고쳐서 다시 저장해 주세요', 'info');
      } else if (textChanged && profileReview.reviewReady && !sentForReview) {
        toast.show('저장했어요. 소개 글은 운영자 확인 중이에요', 'success');
      } else if (sentForReview) {
        const { data: operators } = await supabase.from('users').select('id').eq('role', 'operator');
        await Promise.all((operators || []).map((o: any) => createNotification({
          userId: o.id,
          type: 'profile_review_requested',
          title: '파트너 소개 글 검수 요청',
          body: `${user!.name}님이 소개 글을 수정했어요`,
          route: '/settlements',
        })));
        toast.show('저장했어요. 소개 글은 운영자 확인 후 회원에게 보여요', 'success');
      } else {
        toast.show('✓ 커리어 프로필을 저장했습니다', 'success');
      }
      setShowStoreModal(false);
    } catch (error: any) {
      console.error('Store save error:', error);
      const msg: string = error?.message || '';
      if (msg.includes('BANNED_WORD')) {
        toast.show(`'${msg.split('BANNED_WORD:')[1] || ''}' 같은 표현은 쓸 수 없어요 (과장 광고 방지)`, 'error');
      } else {
        toast.show('저장하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRefund() {
    if (!user || !refundable) return;
    if (!refundBank.bankName.trim() || !refundBank.accountNumber.trim() || !refundBank.accountHolder.trim()) {
      toast.show('환불받을 계좌 정보를 모두 입력해주세요', 'error');
      return;
    }
    setRequestingRefund(true);
    try {
      const { error } = await requestRefund({ hopefulId: user.id, ...refundBank });
      if (error?.code === '23505') {
        // 이미 처리 중인 요청이 있음 (빠른 두 번 클릭 등)
        setShowRefundSheet(false);
        toast.show('이미 처리 중인 환불 요청이 있어요', 'info');
        setShowCreditsModal(true);
        return;
      }
      if (error) throw error;
      // 운영자에게 알림
      const { data: operators } = await supabase.from('users').select('id').eq('role', 'operator');
      await Promise.all((operators || []).map((o: any) => createNotification({
        userId: o.id,
        type: 'refund_requested',
        title: '새 환불 요청이 있습니다',
        body: `${user.name}님 · 약 ${refundable.total.toLocaleString()}원`,
        route: '/settlements',
      })));
      setShowRefundSheet(false);
      toast.show('환불을 요청했어요. 영업일 3일 이내에 처리돼요', 'success');
      setShowCreditsModal(true);
    } catch (error) {
      console.error('환불 요청 오류:', error);
      toast.show('환불 요청 중 오류가 발생했습니다', 'error');
    } finally {
      setRequestingRefund(false);
    }
  }

  async function handleWithdraw() {
    if (!user) return;
    const ok = await confirm({
      title: '정말 탈퇴할까요?',
      message: '프로필, 사진, 파트너 연결 정보가 삭제되고 되돌릴 수 없어요. 결제·정산 기록은 법에 따라 5년간 보관됩니다.',
      confirmText: '탈퇴',
      destructive: true,
    });
    if (!ok) return;
    setWithdrawing(true);
    try {
      const result = await withdrawAccount(user.id);
      if (result.ok) {
        await logout({ forget: true });
        router.replace('/');
        toast.show('탈퇴가 완료되었어요. 그동안 이용해주셔서 감사합니다', 'success');
        return;
      }
      if (result.reason === 'in_progress') {
        toast.show('진행 중인 매칭이 있어요. 매칭이 마무리된 뒤 탈퇴할 수 있어요', 'error');
      } else if (result.reason === 'refund_needed') {
        toast.show(`환불받을 금액 ${(result.amount ?? 0).toLocaleString()}원이 남아 있어요. 먼저 환불을 요청해주세요`, 'error');
        setShowCreditsModal(true);
      } else if (result.reason === 'payout_left') {
        toast.show(`출금하지 않은 정산금 ${(result.amount ?? 0).toLocaleString()}원이 있어요. 계좌 정보에서 출금한 뒤 탈퇴해주세요`, 'error');
      } else {
        toast.show('탈퇴 처리 중 오류가 발생했습니다', 'error');
      }
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      router.replace('/');
    } catch (error) {
      console.error('로그아웃 오류:', error);
      toast.show('로그아웃 중 오류가 발생했습니다', 'error');
    }
  }

  async function loadBankInfo() {
    if (!user) return;
    setLoadingBank(true);
    try {
      const { data: bankRow } = await supabase.from('connector_bank_accounts').select('*').eq('connector_id', user.id).maybeSingle();
      if (bankRow) {
        setBankName(bankRow.bank_name);
        setAccountNumber(bankRow.account_number);
        setAccountHolder(bankRow.account_holder);
      }

      const { data: paidSettlements } = await supabase.from('settlements').select('connector_payout').eq('connector_id', user.id).eq('status', 'paid');
      const totalEarned = (paidSettlements || []).reduce((sum, s: any) => sum + Number(s.connector_payout), 0);

      const { data: withdrawals } = await supabase.from('withdrawal_requests').select('*').eq('connector_id', user.id).order('requested_at', { ascending: false });
      const totalWithdrawn = (withdrawals || []).reduce((sum: number, w: any) => sum + Number(w.amount), 0);

      setAvailableBalance(totalEarned - totalWithdrawn);
      setMyWithdrawals(withdrawals || []);
    } catch (error) {
      console.error('계좌 정보 로드 오류:', error);
    } finally {
      setLoadingBank(false);
    }
  }

  async function handleSaveBankInfo() {
    if (!user) return;
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      toast.show('은행, 계좌번호, 예금주를 모두 입력해주세요', 'error');
      return;
    }
    setSavingBank(true);
    try {
      const { error } = await supabase.from('connector_bank_accounts').upsert({
        connector_id: user.id,
        bank_name: bankName,
        account_number: accountNumber,
        account_holder: accountHolder,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.show('✓ 계좌 정보를 저장했습니다', 'success');
    } catch (error) {
      console.error('계좌 저장 오류:', error);
      toast.show('저장 중 오류가 발생했습니다', 'error');
    } finally {
      setSavingBank(false);
    }
  }

  async function handleRequestWithdrawal() {
    if (!user || requestingWithdrawal) return;
    // "50,000"처럼 쉼표를 넣어도 숫자만 읽는다
    const amount = Number(withdrawAmount.replace(/[^0-9]/g, ''));
    if (!amount || amount <= 0) {
      toast.show('출금할 금액을 입력해주세요', 'error');
      return;
    }
    if (amount > availableBalance) {
      toast.show('출금 가능 금액을 초과했습니다', 'error');
      return;
    }
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      toast.show('먼저 계좌 정보를 저장해주세요', 'error');
      return;
    }
    setRequestingWithdrawal(true);
    try {
      // 출금 가능 금액 확인과 신청 기록을 서버에서 한 번에 (두 번 눌러도 잔액을 넘지 않도록)
      const { data: result, error } = await supabase.rpc('fn_request_withdrawal', {
        p_connector_id: user.id,
        p_amount: amount,
        p_bank_name: bankName,
        p_account_number: accountNumber,
        p_account_holder: accountHolder,
      });
      if (error || !result) throw error;
      if (!result.ok) {
        toast.show(
          result.reason === 'invalid'
            ? '출금할 금액을 확인해주세요'
            : `출금 가능 금액(${Number(result.available ?? 0).toLocaleString()}원)을 초과했습니다`,
          'error'
        );
      } else {
        toast.show('✓ 출금을 신청했습니다', 'success');
        setWithdrawAmount('');
      }
      await loadBankInfo();
    } catch (error) {
      console.error('출금 신청 오류:', error);
      toast.show('출금 신청 중 오류가 발생했습니다', 'error');
    } finally {
      setRequestingWithdrawal(false);
    }
  }

  async function handleSwitchToConnector() {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('users').update({ role: 'connector' }).eq('id', user.id);
      if (error) throw error;
      setShowConnectorModal(false);
      await updateUser({ role: 'connector' });
      toast.show('파트너 화면으로 전환했습니다', 'success');
    } catch (error) {
      toast.show('전환 중 오류가 발생했습니다', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitchToHopeful() {
    if (!user) return;
    if (!(await confirm({ title: '회원 화면으로 전환할까요?', message: '마이 › 매칭 파트너에서 언제든 파트너 화면으로 돌아올 수 있어요.', confirmText: '전환' }))) return;
    try {
      const { error } = await supabase.from('users').update({ role: 'hopeful' }).eq('id', user.id);
      if (error) throw error;
      await updateUser({ role: 'hopeful' });
      toast.show('✓ 회원 화면으로 전환했습니다', 'success');
    } catch (error) {
      console.error('역할 전환 오류:', error);
      toast.show('역할 전환 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleConnectorSignup() {
    if (!businessName.trim()) {
      toast.show('회사명을 입력해주세요', 'error');
      return;
    }
    if (!partnerConsents.includes('partner')) {
      toast.show('파트너 이용약관에 동의해주세요', 'error');
      return;
    }

    setLoading(true);
    try {
      // 위촉 온보딩 신청: 운영자 승인 전까지는 role을 바꾸지 않는다
      const { error: connectorError } = await supabase
        .from('connectors')
        .upsert({
          id: user!.id,
          business_name: businessName,
          status: 'pending',
        })
        .select();

      if (connectorError) throw connectorError;

      await recordConsents(user!.id, ['partner']);
      setConnectorApplicationStatus('pending');
      toast.show('✓ 신청했어요. 운영자가 확인하면 알려드릴게요', 'success');
      setBusinessName('');
    } catch (error) {
      console.error('Connector signup error:', error);
      toast.show('파트너 신청에 실패했습니다. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerBellWrap}>
          <NotificationBell />
        </View>
        <View style={styles.avatarWrap}>
          <Avatar photoUrls={photoUrls} size={70} />
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        {user?.role === 'connector' && (
          <Text style={styles.grade}>{!user.grade || user.grade === 'new' ? '신규 파트너' : `${user.grade} 등급`}</Text>
        )}
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
        {user?.role === 'hopeful' && (
          <>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowProfileModal(true)}>
            <Text style={styles.menuIcon}>📋</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>내 프로필</Text>
              <Text style={styles.menuSub}>개인 정보 관리</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowCreditsModal(true)}>
            <Text style={styles.menuIcon}>💳</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>이용권/결제</Text>
              <Text style={styles.menuSub}>충전, 이용권, 환불</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowConnectorModal(true)}>
            <Text style={styles.menuIcon}>💼</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>매칭 파트너</Text>
              <Text style={styles.menuSub}>우리 모임 친구들을 소개해 주세요</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
          </>
        )}
        {user?.role === 'connector' && (
          <>
          {/* 새 기능: 회원을 늘리는 가장 빠른 방법이라 맨 위에 강조해서 둔다 */}
          <TouchableOpacity style={[styles.menuItem, styles.inviteItem]} onPress={() => setShowInvite(true)}>
            <Text style={styles.menuIcon}>📣</Text>
            <View style={styles.menuContent}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.menuTitle}>광고하기</Text>
                <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>
              </View>
              <Text style={styles.menuSub}>초대 링크로 내 회원 모으기</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowSettlementsModal(true)}>
            <Text style={styles.menuIcon}>💰</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>정산</Text>
              <Text style={styles.menuSub}>이용권 사용 및 지급 내역</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMyReviews(null);
              setShowReviewsSheet(true);
              fetchConnectorReviews(user.id).then(setMyReviews);
            }}
          >
            <Text style={styles.menuIcon}>💬</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>받은 후기</Text>
              <Text style={styles.menuSub}>회원들이 남긴 별점과 한마디</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push('/alliances')}>
            <Text style={styles.menuIcon}>🤝</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>동맹 관리</Text>
              <Text style={styles.menuSub}>다른 파트너와 동맹 맺기·해지</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowCreditScoreModal(true)}>
            <Text style={styles.menuIcon}>⭐</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>신뢰지표</Text>
              <Text style={styles.menuSub}>등급 및 신뢰 점수</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowStoreModal(true)}>
            <Text style={styles.menuIcon}>🏪</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>커리어 프로필</Text>
              <Text style={styles.menuSub}>회원 정보, 가격, 소개 지역</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowBankModal(true)}>
            <Text style={styles.menuIcon}>🏦</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>계좌 정보</Text>
              <Text style={styles.menuSub}>출금 계좌 관리</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToHopeful}>
            <Text style={styles.menuIcon}>🔄</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>역할 전환</Text>
              <Text style={styles.menuSub}>회원 화면으로 이동</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
          </>
        )}
        {user?.role === 'operator' && (
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowBusiness(true)}>
            <Text style={styles.menuIcon}>🏢</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>사업자 정보</Text>
              <Text style={styles.menuSub}>화면 하단·약관 표시, 결혼중개업 신고번호</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )}
        {user?.role === 'operator' && (
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowWatermark(true)}>
            <Text style={styles.menuIcon}>🔍</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>워터마크 번호로 회원 찾기</Text>
              <Text style={styles.menuSub}>캡처된 사진이 누구 화면인지 확인</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )}
        {user?.role === 'operator' && (
          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        )}
        <View style={styles.policyLinks}>
          {([
            ['service', '이용약관'],
            ['privacy', '개인정보 처리방침'],
            ...(user?.role !== 'hopeful' ? [['partner', '파트너 이용약관']] : []),
          ] as [TermsDocKey, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setViewingTerms(key)} style={styles.policyLink}>
              <Text style={styles.policyLinkText}>{label}</Text>
            </TouchableOpacity>
          ))}
          {user?.role !== 'operator' && (
            <TouchableOpacity onPress={() => setShowBlocks(true)} style={styles.policyLink}>
              <Text style={styles.policyLinkText}>차단 목록</Text>
            </TouchableOpacity>
          )}
          {user?.role !== 'operator' && (
            <TouchableOpacity onPress={handleWithdraw} disabled={withdrawing} style={styles.policyLink}>
              <Text style={styles.policyLinkText}>{withdrawing ? '처리 중...' : '회원 탈퇴'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* 배포된 버전 확인용 (커밋 번호) */}
        <BusinessInfo />
        <Text style={styles.buildId}>버전 {(process.env.EXPO_PUBLIC_BUILD_ID || 'dev').slice(0, 7)}</Text>
        </View>
      </ScrollView>

      <TermsSheet docKey={viewingTerms} onClose={() => setViewingTerms(null)} />
      {user?.role === 'operator' && <BusinessSettingsSheet visible={showBusiness} onClose={() => setShowBusiness(false)} />}
      {user?.role === 'operator' && <WatermarkLookupSheet visible={showWatermark} onClose={() => setShowWatermark(false)} />}

      <BottomSheet visible={showRefundSheet} onClose={() => { setShowRefundSheet(false); setShowCreditsModal(true); }} title="환불 요청">
        <View style={styles.gradeBox}>
          <Text style={styles.gradeBoxLabel}>환불 예정 금액</Text>
          <Text style={styles.gradeBoxValue}>{(refundable?.total ?? 0).toLocaleString()}원</Text>
          <Text style={styles.gradeBoxScore}>처리 시점의 남은 금액으로 확정돼요</Text>
        </View>
        <Text style={styles.modalLabel}>은행명</Text>
        <TextInput style={styles.modalInput} placeholder="국민은행" placeholderTextColor="#ddd" value={refundBank.bankName}
          onChangeText={(v) => setRefundBank((b) => ({ ...b, bankName: v }))} editable={!requestingRefund} />
        <Text style={styles.modalLabel}>계좌번호</Text>
        <TextInput style={styles.modalInput} placeholder="숫자만 입력" placeholderTextColor="#ddd" value={refundBank.accountNumber}
          onChangeText={(v) => setRefundBank((b) => ({ ...b, accountNumber: v }))} keyboardType="number-pad" editable={!requestingRefund} />
        <Text style={styles.modalLabel}>예금주</Text>
        <TextInput style={styles.modalInput} placeholder="홍길동" placeholderTextColor="#ddd" value={refundBank.accountHolder}
          onChangeText={(v) => setRefundBank((b) => ({ ...b, accountHolder: v }))} editable={!requestingRefund} />
        <TouchableOpacity
          style={[styles.storeSaveBtn, requestingRefund && styles.storeSaveBtnDisabled]}
          onPress={handleRequestRefund}
          disabled={requestingRefund}
        >
          {requestingRefund ? <ActivityIndicator color="#fff" /> : <Text style={styles.storeSaveBtnText}>환불 요청하기</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <BlockListSheet visible={showBlocks} onClose={() => setShowBlocks(false)} />
      {user?.role === 'connector' && (
        <InviteSheet visible={showInvite} onClose={() => setShowInvite(false)} partnerName={user.name} />
      )}

      <BottomSheet visible={showProfileModal} onClose={() => setShowProfileModal(false)} title="내 프로필 수정">
        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>사진</Text>
          {user && <PhotoEditor userId={user.id} photos={photoUrls} onChange={setPhotoUrls} />}
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>지역</Text>
          <View style={styles.buttonGroup}>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={[styles.optionBtn, profileData.location === loc && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, location: loc})}
              >
                <Text style={[styles.optionBtnText, profileData.location === loc && styles.optionBtnTextSelected]}>{loc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>생년월일</Text>
          <View style={[styles.formInput, {justifyContent: 'center', paddingLeft: 10}]}>
            <Text style={{color: '#333', fontSize: 16}}>
              {user?.birth_date || '-'}
            </Text>
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>키 (cm)</Text>
          <TextInput
            style={styles.formInput}
            placeholder="170"
            placeholderTextColor="#ddd"
            keyboardType="number-pad"
            value={profileData.height}
            onChangeText={(text) => setProfileData({...profileData, height: text})}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>직업</Text>
          <TextInput
            style={styles.formInput}
            placeholder="개발자"
            placeholderTextColor="#ddd"
            value={profileData.job}
            onChangeText={(text) => setProfileData({...profileData, job: text})}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>학력</Text>
          <View style={styles.buttonGroup}>
            {educations.map((edu) => (
              <TouchableOpacity
                key={edu}
                style={[styles.optionBtn, profileData.education === edu && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, education: edu})}
              >
                <Text style={[styles.optionBtnText, profileData.education === edu && styles.optionBtnTextSelected]}>{edu}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>종교</Text>
          <View style={styles.buttonGroup}>
            {religions.map((rel) => (
              <TouchableOpacity
                key={rel}
                style={[styles.optionBtn, profileData.religion === rel && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, religion: rel})}
              >
                <Text style={[styles.optionBtnText, profileData.religion === rel && styles.optionBtnTextSelected]}>{rel}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>흡연</Text>
          <View style={styles.buttonGroup}>
            {smokings.map((smk) => (
              <TouchableOpacity
                key={smk}
                style={[styles.optionBtn, profileData.smoking === smk && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, smoking: smk})}
              >
                <Text style={[styles.optionBtnText, profileData.smoking === smk && styles.optionBtnTextSelected]}>{smk}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>음주</Text>
          <View style={styles.buttonGroup}>
            {drinkings.map((drk) => (
              <TouchableOpacity
                key={drk}
                style={[styles.optionBtn, profileData.drinking === drk && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, drinking: drk})}
              >
                <Text style={[styles.optionBtnText, profileData.drinking === drk && styles.optionBtnTextSelected]}>{drk}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>체형</Text>
          <View style={styles.buttonGroup}>
            {bodyTypes.map((body) => (
              <TouchableOpacity
                key={body}
                style={[styles.optionBtn, profileData.body_type === body && styles.optionBtnSelected]}
                onPress={() => setProfileData({...profileData, body_type: body})}
              >
                <Text style={[styles.optionBtnText, profileData.body_type === body && styles.optionBtnTextSelected]}>{body}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>자기소개</Text>
          <TextInput
            style={[styles.formInput, {minHeight: 100}]}
            placeholder="자신을 소개해주세요"
            placeholderTextColor="#ddd"
            multiline
            value={profileData.bio}
            onChangeText={(text) => setProfileData({...profileData, bio: text})}
          />
        </View>

        <TouchableOpacity
          style={[styles.profileSaveBtn, (loading || !profileLoaded) && styles.storeSaveBtnDisabled]}
          onPress={handleProfileSave}
          disabled={loading || !profileLoaded}
        >
          <Text style={styles.profileSaveBtnText}>{loading ? '저장 중...' : !profileLoaded ? '불러오는 중...' : '저장하기'}</Text>
        </TouchableOpacity>
      </BottomSheet>

      <BottomSheet
        visible={showConnectorModal}
        onClose={() => setShowConnectorModal(false)}
        title={connectorApplicationStatus === 'pending' ? '심사 중입니다' : connectorApplicationStatus === 'approved' ? '매칭 파트너' : '파트너로 활동하기'}
      >
            {connectorApplicationStatus === 'approved' ? (
              <>
                <Text style={{ color: '#666', fontSize: 13, marginBottom: 20, lineHeight: 20 }}>
                  이미 승인된 매칭 파트너입니다.{'\n'}파트너 화면으로 돌아갈 수 있어요.
                </Text>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnConfirm, loading && styles.modalBtnDisabled]}
                  onPress={handleSwitchToConnector}
                  disabled={loading}
                >
                  <Text style={styles.modalBtnText}>{loading ? '전환 중...' : '파트너 화면으로 돌아가기'}</Text>
                </TouchableOpacity>
              </>
            ) : connectorApplicationStatus === 'pending' ? (
              <>
                <Text style={{ color: '#666', fontSize: 13, marginBottom: 20, lineHeight: 20 }}>
                  신청이 접수됐어요.{'\n'}운영자가 확인하면 알려드릴게요. 그때부터 파트너 화면을 쓸 수 있어요.
                </Text>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnConfirm]}
                  onPress={() => setShowConnectorModal(false)}
                >
                  <Text style={styles.modalBtnText}>확인</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {connectorApplicationStatus === 'rejected' && (
                  <Text style={{ color: '#E53935', fontSize: 12, marginBottom: 10 }}>
                    이전 신청이 반려되었습니다. 다시 신청할 수 있습니다.
                  </Text>
                )}
                <Text style={styles.partnerIntro}>
                  모임·동호회 대표라면 누구나 시작할 수 있어요. 우리 모임 친구들을 다른 모임 친구들과 이어 주고, 소개가 성사될 때마다 소개비를 받아요. 사업자가 없어도 괜찮아요.
                </Text>
                <Text style={styles.modalLabel}>모임 이름 (회원에게 보이는 이름)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="예: 행복매칭, 판교 러닝크루"
                  placeholderTextColor="#ddd"
                  value={businessName}
                  onChangeText={setBusinessName}
                  editable={!loading}
                />
                <View style={{ marginTop: 12 }}>
                  <ConsentChecklist items={PARTNER_CONSENTS} checked={partnerConsents} onChange={setPartnerConsents} disabled={loading} />
                </View>
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnCancel]}
                    onPress={() => {
                      setShowConnectorModal(false);
                      setBusinessName('');
                    }}
                  >
                    <Text style={styles.modalBtnTextCancel}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalBtnConfirm, (loading || !partnerConsents.includes('partner')) && styles.modalBtnDisabled]}
                    onPress={handleConnectorSignup}
                    disabled={loading || !partnerConsents.includes('partner')}
                  >
                    <Text style={styles.modalBtnText}>{loading ? '신청 중...' : '신청하기'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
      </BottomSheet>

      {/* 스토어관리 시트 */}
      <BottomSheet visible={showStoreModal} onClose={() => setShowStoreModal(false)} title="커리어 프로필">
        {profileReview.reviewReady && profileReview.status === 'PENDING' && (
          <View style={styles.reviewBanner}>
            <Text style={styles.reviewBannerTitle}>⏳ 소개 글 검수 중</Text>
            <Text style={styles.reviewBannerText}>운영자가 확인하면 회원에게 보여요. 그 전까지는 이전 소개 글이 보여요.</Text>
          </View>
        )}
        {profileReview.reviewReady && profileReview.status === 'REJECTED' && (
          <View style={[styles.reviewBanner, styles.reviewBannerRejected]}>
            <Text style={[styles.reviewBannerTitle, { color: '#E53935' }]}>소개 글이 반려됐어요</Text>
            <Text style={styles.reviewBannerText}>{profileReview.reason ? `사유: ${profileReview.reason}. ` : ''}수정해서 다시 저장해 주세요.</Text>
          </View>
        )}
        {/* 회원수 표시 (입력불가) */}
        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>남성 회원</Text>
            <Text style={styles.statValue}>{storeData.male_count}명</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>여성 회원</Text>
            <Text style={styles.statValue}>{storeData.female_count}명</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>매칭 성공</Text>
            <Text style={styles.statValue}>{storeData.matching_count}건</Text>
          </View>
        </View>

        {/* 회원이 파트너를 고를 때 보는 소개 (파트너 탭 › 파트너 상세) */}
        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>대표 사진</Text>
          {user && <PhotoEditor userId={user.id} photos={photoUrls} onChange={setPhotoUrls} />}
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>경력</Text>
          <TextInput
            style={styles.formInput}
            placeholder="예: 결혼정보회사 커플매니저 5년"
            placeholderTextColor="#ddd"
            value={storeData.career}
            onChangeText={(text) => setStoreData({ ...storeData, career: text })}
            maxLength={60}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>파트너 소개</Text>
          <TextInput
            style={[styles.formInput, { height: 100, textAlignVertical: 'top' }]}
            placeholder="어떤 분들을 주로 소개하는지, 소개 방식, 회원에게 하고 싶은 말을 적어주세요"
            placeholderTextColor="#ddd"
            multiline
            numberOfLines={5}
            value={storeData.intro}
            onChangeText={(text) => setStoreData({ ...storeData, intro: text })}
            maxLength={500}
          />
          <Text style={styles.formHint}>회원이 파트너 정보에서 가입 여부를 정할 때 보는 내용이에요. 경력·소개·서비스 설명은 운영자 확인 후 공개되고, '보장·100%·확실' 같은 과장 표현은 쓸 수 없어요.</Text>
        </View>

        {/* 주요지역 선택 - 버튼형 (중복 선택 가능) */}
        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>주요지역 (중복 선택 가능)</Text>
          <View style={styles.buttonGroup}>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={[styles.optionBtn, selectedRegions.includes(loc) && styles.optionBtnSelected]}
                onPress={() => {
                  if (selectedRegions.includes(loc)) {
                    setSelectedRegions(selectedRegions.filter(r => r !== loc));
                  } else {
                    setSelectedRegions([...selectedRegions, loc]);
                  }
                }}
              >
                <Text style={[styles.optionBtnText, selectedRegions.includes(loc) && styles.optionBtnTextSelected]}>
                  {loc}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedRegions.length > 0 && (
            <View style={styles.selectedRegionsTag}>
              <Text style={styles.selectedRegionsText}>선택: {selectedRegions.join(', ')}</Text>
            </View>
          )}
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>회당 금액 (원)</Text>
          <TextInput
            style={styles.formInput}
            placeholder="45000"
            placeholderTextColor="#ddd"
            keyboardType="number-pad"
            value={storeData.fee_per_session}
            onChangeText={(text) => setStoreData({...storeData, fee_per_session: text})}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>서비스 설명</Text>
          <TextInput
            style={[styles.formInput, {height: 100, textAlignVertical: 'top'}]}
            placeholder="서비스에 대해 설명해주세요"
            placeholderTextColor="#ddd"
            multiline
            numberOfLines={5}
            value={storeData.service_description}
            onChangeText={(text) => setStoreData({...storeData, service_description: text})}
          />
        </View>

        <TouchableOpacity
          style={[styles.storeSaveBtn, loading && styles.storeSaveBtnDisabled]}
          onPress={handleStoreSave}
          disabled={loading}
        >
          <Text style={styles.storeSaveBtnText}>
            {loading ? '⏳ 저장 중...' : '✓ 저장하기'}
          </Text>
        </TouchableOpacity>
      </BottomSheet>

      <BottomSheet visible={showCreditsModal} onClose={() => setShowCreditsModal(false)} title="이용권/결제">

        {loadingCredits ? (
          <Text style={{ color: '#999', paddingVertical: 20 }}>불러오는 중...</Text>
        ) : (
          <>
            <View style={styles.walletBalanceBox}>
              <Text style={styles.walletBalanceLabel}>충전된 금액</Text>
              <Text style={styles.walletBalanceValue}>{Math.max(0, walletBalance).toLocaleString()}원</Text>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>충전하기</Text>

              <Text style={styles.formLabel}>충전 금액</Text>
              <View style={styles.buttonGroup}>
                {CHARGE_OPTIONS.map((amount) => (
                  <TouchableOpacity
                    key={amount}
                    style={[styles.optionBtn, chargeAmount === amount && styles.optionBtnSelected]}
                    onPress={() => setChargeAmount(amount)}
                  >
                    <Text style={[styles.optionBtnText, chargeAmount === amount && styles.optionBtnTextSelected]}>
                      {amount.toLocaleString()}원
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.storeSaveBtn, charging && styles.storeSaveBtnDisabled]}
                onPress={handleCharge}
                disabled={charging}
              >
                <Text style={styles.storeSaveBtnText}>{charging ? '충전 중...' : '충전하기'}</Text>
              </TouchableOpacity>
              {process.env.EXPO_PUBLIC_TEST_MODE === 'true' && (
                <Text style={styles.chargeNotice}>테스트 기간에는 실제 결제 없이 충전됩니다</Text>
              )}
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>이용권 현황</Text>
              {myConnectorCredits.length === 0 ? (
                <Text style={{ color: '#999', paddingVertical: 12 }}>아직 구매한 이용권이 없습니다. 파트너 탭에서 가입이 승인된 파트너의 이용권을 구매해보세요.</Text>
              ) : (
                myConnectorCredits.map((c) => (
                  <View key={c.connectorId} style={styles.creditCard}>
                    <View style={styles.creditCardHeader}>
                      <Text style={styles.creditConnectorName}>{c.connectorName}</Text>
                      <Text style={styles.creditFee}>{c.feePerSession?.toLocaleString() || '-'}원 / 회</Text>
                    </View>
                    <View style={styles.creditRow}>
                      <View style={styles.creditStat}>
                        <Text style={styles.creditStatLabel}>구매</Text>
                        <Text style={styles.creditStatValue}>{c.purchased}회</Text>
                      </View>
                      <View style={styles.creditStat}>
                        <Text style={styles.creditStatLabel}>잔여</Text>
                        <Text style={styles.creditStatValue}>{c.available}회</Text>
                      </View>
                      <View style={styles.creditStat}>
                        <Text style={styles.creditStatLabel}>사용</Text>
                        <Text style={styles.creditStatValueMuted}>{c.used}회</Text>
                      </View>
                    </View>
                    {c.refunded > 0 && <Text style={styles.refundedNote}>환불 {c.refunded}회</Text>}
                  </View>
                ))
              )}
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>환불</Text>
              {pendingRefund ? (
                <View style={styles.refundPendingBox}>
                  <Text style={styles.refundPendingText}>환불 요청을 처리하고 있어요</Text>
                  <Text style={styles.refundHint}>
                    {new Date(pendingRefund.requested_at).toLocaleDateString('ko-KR')} 요청 · 영업일 3일 이내에 {pendingRefund.bank_name} 계좌로 보내드려요
                  </Text>
                </View>
              ) : refundable && refundable.total > 0 ? (
                <>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>환불 가능 금액</Text>
                    <Text style={styles.infoValue}>{refundable.total.toLocaleString()}원</Text>
                  </View>
                  <Text style={styles.refundHint}>
                    충전 잔액 {refundable.wallet.toLocaleString()}원 + 남은 이용권 {refundable.sessions}회 {refundable.credit.toLocaleString()}원{'\n'}
                    진행 중인 매칭에 필요한 이용권은 제외돼요.
                  </Text>
                  <TouchableOpacity
                    style={styles.refundBtn}
                    onPress={() => {
                      // 시트 위에 시트를 겹치지 않는다
                      setShowCreditsModal(false);
                      setShowRefundSheet(true);
                    }}
                  >
                    <Text style={styles.refundBtnText}>환불 요청하기</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.refundHint}>환불받을 금액이 없어요</Text>
              )}
            </View>
          </>
        )}
      </BottomSheet>

      <BottomSheet visible={showSettlementsModal} onClose={() => setShowSettlementsModal(false)} title="정산관리">

        {loadingSettlements ? (
          <Text style={{ color: '#999', paddingVertical: 20 }}>불러오는 중...</Text>
        ) : mySettlements.length === 0 ? (
          <Text style={{ color: '#999', paddingVertical: 20 }}>정산 내역이 없습니다</Text>
        ) : (
          <>
            <View style={styles.statsContainer}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>총 정산액</Text>
                <Text style={styles.statValue}>
                  {mySettlements.reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>정산 완료</Text>
                <Text style={styles.statValue}>
                  {mySettlements.filter((s) => s.status === 'paid').reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>정산 대기</Text>
                <Text style={styles.statValue}>
                  {mySettlements.filter((s) => s.status === 'pending').reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                </Text>
              </View>
            </View>

            <Text style={styles.chargeNotice}>정산된 금액은 마이 › 계좌 정보에서 출금 신청할 수 있어요</Text>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>이용권 사용 내역</Text>
              {mySettlements.map((s) => (
                <View key={s.id} style={styles.creditCard}>
                  <View style={styles.creditCardHeader}>
                    <Text style={styles.creditConnectorName}>{s.hopefulName}님의 이용권 사용</Text>
                    <Text style={styles.creditFee}>{new Date(s.created_at).toLocaleDateString('ko-KR')}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>회당 금액</Text>
                    <Text style={styles.infoValue}>{Number(s.amount_per_session).toLocaleString()}원</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>플랫폼 수수료 (20%)</Text>
                    <Text style={styles.infoValue}>-{Number(s.platform_fee).toLocaleString()}원</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>지급액 (80%)</Text>
                    <Text style={[styles.infoValue, { color: '#5B21FF', fontWeight: '700' }]}>
                      {Number(s.connector_payout).toLocaleString()}원
                    </Text>
                  </View>
                  {s.status === 'paid' ? (
                    <View style={styles.paidBadge}>
                      <Text style={styles.paidBadgeText}>
                        ✓ {s.settled_at ? new Date(s.settled_at).toLocaleDateString('ko-KR') : ''} 정산 완료
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>정산 대기중</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </BottomSheet>

      <BottomSheet visible={showReviewsSheet} onClose={() => setShowReviewsSheet(false)} title="받은 후기">
        <ReviewList reviews={myReviews} emptyText="아직 받은 후기가 없어요. 매칭을 마친 회원이 후기를 남기면 여기에 보여요." />
      </BottomSheet>

      <BottomSheet visible={showCreditScoreModal} onClose={() => setShowCreditScoreModal(false)} title="신뢰지표">

        {loadingCreditScore ? (
          <ActivityIndicator size="large" color="#5B21FF" style={{ marginTop: 40 }} />
        ) : !creditScore ? (
          <Text style={{ color: '#999', paddingVertical: 20 }}>신뢰지표를 불러오지 못했습니다</Text>
        ) : (creditScore.finished_count ?? creditScore.total_proposed) === 0 ? (
          <View style={styles.comingSoonContainer}>
            <Text style={styles.comingSoonIcon}>⭐</Text>
            <Text style={styles.comingSoonText}>아직 끝난 매칭이 없습니다</Text>
            <Text style={styles.comingSoonSub}>
              {creditScore.in_progress_count ? `진행 중 ${creditScore.in_progress_count}건 · ` : ''}첫 매칭이 마무리되면 등급이 산정됩니다
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.gradeBox}>
              <Text style={styles.gradeBoxLabel}>현재 등급</Text>
              <Text style={styles.gradeBoxValue}>{creditScore.grade === 'new' ? '신규' : creditScore.grade}</Text>
              <Text style={styles.gradeBoxScore}>종합 점수 {creditScore.overall_score}점</Text>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>세부 점수</Text>
              {[
                { label: '매칭 성사율', score: creditScore.success_score, basis: `끝난 매칭 ${creditScore.finished_count ?? 0}건 중 ${creditScore.settled_count}건 성사` },
                { label: '애프터 성사율', score: creditScore.mutual_score, basis: `두 회원 모두 다시 만나길 원한 매칭 ${creditScore.mutual_count ?? 0}건` },
                { label: '회원 만족도', score: creditScore.review_score, basis: creditScore.review_count ? `후기 ${creditScore.review_count}개 · 평균 ★ ${Number(creditScore.review_avg).toFixed(1)}` : '아직 후기가 없어요' },
                { label: '노쇼 없음', score: creditScore.trust_score, basis: `노쇼 신고 ${creditScore.noshow_dispute_count}건` },
                { label: '활동량', score: creditScore.activity_score, basis: `성사 ${creditScore.settled_count}건 (10건이면 만점)` },
              ].map((row) => (
                <View key={row.label} style={styles.scoreRow}>
                  <View style={styles.scoreRowText}>
                    <Text style={styles.infoLabel}>{row.label}</Text>
                    <Text style={styles.scoreBasis}>{row.basis}</Text>
                  </View>
                  <Text style={styles.infoValue}>{row.score === null || row.score === undefined ? '-' : `${row.score}점`}</Text>
                </View>
              ))}
              <Text style={styles.scoreHint}>
                진행 중인 매칭{creditScore.in_progress_count ? ` ${creditScore.in_progress_count}건` : ''}은 끝난 뒤에 반영돼요. '-' 항목은 종합 점수에서 빠져요.
              </Text>
            </View>
          </>
        )}
      </BottomSheet>

      <BottomSheet visible={showBankModal} onClose={() => setShowBankModal(false)} title="계좌 정보">

        {loadingBank ? (
          <ActivityIndicator size="large" color="#5B21FF" style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.gradeBox}>
              <Text style={styles.gradeBoxLabel}>출금 가능 금액</Text>
              <Text style={styles.gradeBoxValue}>{availableBalance.toLocaleString()}원</Text>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>출금 계좌</Text>
              <Text style={styles.modalLabel}>은행명</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="국민은행"
                placeholderTextColor="#ddd"
                value={bankName}
                onChangeText={setBankName}
                editable={!savingBank}
              />
              <Text style={styles.modalLabel}>계좌번호</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="숫자만 입력"
                placeholderTextColor="#ddd"
                value={accountNumber}
                onChangeText={setAccountNumber}
                editable={!savingBank}
                keyboardType="number-pad"
              />
              <Text style={styles.modalLabel}>예금주</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="홍길동"
                placeholderTextColor="#ddd"
                value={accountHolder}
                onChangeText={setAccountHolder}
                editable={!savingBank}
              />
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, savingBank && styles.modalBtnDisabled, { marginTop: 12 }]}
                onPress={handleSaveBankInfo}
                disabled={savingBank}
              >
                <Text style={styles.modalBtnText}>{savingBank ? '저장 중...' : '계좌 저장'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>출금 신청</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="출금할 금액"
                placeholderTextColor="#ddd"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                editable={!requestingWithdrawal}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, requestingWithdrawal && styles.modalBtnDisabled, { marginTop: 12 }]}
                onPress={handleRequestWithdrawal}
                disabled={requestingWithdrawal}
              >
                <Text style={styles.modalBtnText}>{requestingWithdrawal ? '신청 중...' : '출금 신청하기'}</Text>
              </TouchableOpacity>
            </View>

            {myWithdrawals.length > 0 && (
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>출금 내역</Text>
                {myWithdrawals.map((w) => (
                  <View key={w.id} style={styles.creditCard}>
                    <View style={styles.creditCardHeader}>
                      <Text style={styles.creditConnectorName}>{Number(w.amount).toLocaleString()}원</Text>
                      <Text style={styles.creditFee}>{new Date(w.requested_at).toLocaleDateString('ko-KR')}</Text>
                    </View>
                    {w.status === 'completed' ? (
                      <View style={styles.paidBadge}>
                        <Text style={styles.paidBadgeText}>✓ 지급 완료</Text>
                      </View>
                    ) : (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>처리 대기중</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: '#F1ECFF',
    borderBottomWidth: 0,
    position: 'relative',
  },
  headerBellWrap: {
    position: 'absolute',
    top: 16,
    right: 12,
  },
  avatarWrap: {
    marginBottom: 12,
  },
  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#5B21FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 36,
    color: '#fff',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 0,
  },
  buildId: {
    textAlign: 'center',
    fontSize: 11,
    color: '#bbb',
    marginBottom: 24,
  },
  policyLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  policyLink: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  policyLinkText: {
    fontSize: 12,
    color: '#999',
    textDecorationLine: 'underline',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
  },
  scoreRowText: {
    flex: 1,
    marginRight: 12,
  },
  scoreBasis: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  scoreHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 10,
    lineHeight: 18,
  },
  grade: {
    fontSize: 1,
    color: '#999',
    height: 0,
    overflow: 'hidden',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  partnerIntro: { fontSize: 14, color: '#444', lineHeight: 21, backgroundColor: '#F7F4FF', borderRadius: 12, padding: 14, marginBottom: 16 },
  reviewBanner: { backgroundColor: '#F7F4FF', borderRadius: 12, padding: 12, marginBottom: 12 },
  reviewBannerRejected: { backgroundColor: '#FFF1F0' },
  reviewBannerTitle: { fontSize: 14, fontWeight: '700', color: '#5B21FF' },
  reviewBannerText: { fontSize: 13, color: '#555', marginTop: 4, lineHeight: 19 },
  inviteItem: { backgroundColor: '#F1ECFF' },
  newBadge: { backgroundColor: '#5B21FF', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  menuIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  menuSub: {
    fontSize: 13,
    color: '#888',
  },
  arrow: {
    fontSize: 18,
    color: '#ddd',
    fontWeight: '300',
  },
  logoutMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 12,
    marginTop: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
  },
  logoutBtn: {
    marginHorizontal: 20,
    marginBottom: 20,
    marginTop: 40,
    borderWidth: 1.5,
    borderColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#E53935',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnCancel: {
    borderWidth: 1.5,
    borderColor: '#ddd',
  },
  modalBtnConfirm: {
    backgroundColor: '#5B21FF',
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  modalBtnTextCancel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#666',
  },
  modalBtnDisabled: {
    opacity: 0.6,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 40,
  },
  profileModalContent: {
    flex: 1,
    paddingHorizontal: 20,
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
  gradeBox: {
    backgroundColor: '#F1ECFF',
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  gradeBoxLabel: {
    fontSize: 12,
    color: '#5B21FF',
    marginBottom: 6,
  },
  gradeBoxValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5B21FF',
    marginBottom: 6,
  },
  gradeBoxScore: {
    fontSize: 12,
    color: '#666',
  },
  comingSoonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  comingSoonIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  comingSoonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  comingSoonSub: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  profileModalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 20,
  },
  profileFormSection: {
    marginBottom: 16,
  },
  formHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 6,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#333',
  },
  profileSaveBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  profileSaveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionBtn: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  optionBtnSelected: {
    borderColor: '#5B21FF',
    backgroundColor: '#EDE4FF',
  },
  optionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  optionBtnTextSelected: {
    color: '#5B21FF',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F1ECFF',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8E0FF',
  },
  statLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 6,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5B21FF',
  },
  creditCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#5B21FF',
  },
  paidBadge: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  paidBadgeText: {
    color: '#5B21FF',
    fontWeight: '500',
    fontSize: 12,
  },
  pendingBadge: {
    backgroundColor: '#F3F3F5',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  pendingBadgeText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 12,
  },
  creditCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  creditConnectorName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  creditFee: {
    fontSize: 12,
    color: '#999',
  },
  creditRow: {
    flexDirection: 'row',
    gap: 10,
  },
  creditStat: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  creditStatLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 4,
  },
  creditStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5B21FF',
  },
  creditStatValueMuted: {
    fontSize: 18,
    fontWeight: '700',
    color: '#999',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  walletBalanceBox: {
    backgroundColor: '#F1ECFF',
    borderRadius: 14,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 28,
  },
  walletBalanceLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },
  walletBalanceValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5B21FF',
  },
  refundedNote: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  refundHint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginTop: 6,
  },
  refundBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  refundBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
  },
  refundPendingBox: {
    backgroundColor: '#F7F7F7',
    borderRadius: 10,
    padding: 14,
  },
  refundPendingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  chargeNotice: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
  modalSection: {
    marginBottom: 28,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  selectedRegionsTag: {
    backgroundColor: '#F1ECFF',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#5B21FF',
  },
  selectedRegionsText: {
    fontSize: 12,
    color: '#5B21FF',
    fontWeight: '600',
  },
  storeSaveBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 20,
    elevation: 3,
    shadowColor: '#5B21FF',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  storeSaveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  storeSaveBtnDisabled: {
    opacity: 0.7,
  },
});
