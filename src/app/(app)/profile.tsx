import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BackupMenuRow } from '@/components/BackupSettings';
import { PushMenuRow } from '@/components/PushSettings';
import { PauseMenuRow } from '@/components/PauseSettings';
import { AwayMenuRow } from '@/components/AwaySettings';
import { profileFill } from '@/lib/profileFill';
import { PrefsMenuRow } from '@/components/PrefsSettings';
import { FeedbackMenuRow } from '@/components/FeedbackSettings';
import { AvoidMenuRow } from '@/components/AvoidSettings';
import PartnerReportSheet from '@/components/PartnerReport';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BusinessSettingsSheet from '@/components/BusinessSettingsSheet';
import WatermarkLookupSheet from '@/components/WatermarkLookupSheet';
import BusinessInfo from '@/components/BusinessInfo';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { partnerIntro, CLEARED_SERVICE_DESCRIPTION } from '@/lib/format';
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
import { CONTACT_HIT_LABEL, ContactHit, findContactIn } from '@/lib/contactGuard';
import { EXTRA_CONDITIONS, JOB_CATEGORIES, toggleCondition } from '@/lib/memberDetails';
import { DISTRICTS } from '@/lib/regions';
import { saveWithdrawReason, WITHDRAW_REASONS } from '@/lib/feedback';
import MemberProfileView from '@/components/MemberProfileView';
import { getPendingRefund, getRefundable, Refundable, requestRefund, withdrawAccount } from '@/lib/refunds';
import { afterWithdraw, prepareWithdraw } from '@/lib/withdrawal';
import { createNotification } from '@/lib/notifications';
import { findBannedWord } from '@/lib/adPolicy';

const PARTNER_CONSENTS: ConsentItem[] = [{ key: 'partner', label: '매칭 파트너 이용약관 동의', doc: 'partner' }];
import { fetchConnectorReviews, Review } from '@/lib/reviews';

// 회당 금액: 가격은 파트너가 정하되, 0원·오타(자릿수 실수)만 막는다
const FEE_MIN = 1000;
const FEE_MAX = 10000000;
const feeDigits = (v: any) => String(v ?? '').replace(/[^0-9]/g, '');

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
  // undefined = 아직 불러오는 중
  const [connectorApplicationStatus, setConnectorApplicationStatus] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  // 처음 프로필을 채울 때는 한 화면에 한 질문씩 (null이면 지금처럼 한 화면에서 수정)
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  // 단계별 입력 중에 닫아도 다시 열면 이어서 하도록 (저장하면 지운다)
  const wizardDraftRef = useRef<{ step: number; data: any } | null>(null);
  // 파트너 신청서 단계 (0 소개 → 1 모임 이름 → 2 약관)
  const [applyStep, setApplyStep] = useState(0);
  const applying = showConnectorModal && (connectorApplicationStatus === null || connectorApplicationStatus === 'rejected');
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
  // 출금 확인 단계: 금액·계좌·입금 시점을 한 번 보여주고 신청한다
  const [withdrawConfirm, setWithdrawConfirm] = useState<number | null>(null);
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
    company: '',
    job_category: '',
    district: '',
    extra_conditions: [] as string[],
  });
  // 회사·직업 분류·해당 조건 칸 (add_company_and_avoid.sql 실행 전에는 없음 → 입력 칸·단계를 숨긴다)
  const [companyAvailable, setCompanyAvailable] = useState(false);
  // 구·시 칸 (add_district.sql 전에는 없음)
  const [districtAvailable, setDistrictAvailable] = useState(false);
  // '상대에게 이렇게 보여요' 미리보기
  const [meBasics, setMeBasics] = useState<{ gender: string | null; age: number | null }>({ gender: null, age: null });
  const [showPreview, setShowPreview] = useState(false);
  // 처음 프로필 채우기 단계 수: 직업 분류·해당 조건 단계가 더해진다
  const profileSteps = PROFILE_STEPS_BASE + (companyAvailable ? 2 : 0);
  // 프로필에 연락처가 들어가 저장을 막은 칸 (약관: 만남일 전 연락처 노출 금지)
  const [contactErr, setContactErr] = useState<{ field: string; hit: ContactHit } | null>(null);
  // 칸을 고치면 경고를 지운다 (다시 저장할 때 다시 검사)
  useEffect(() => { setContactErr(null); }, [profileData.bio, profileData.job, profileData.company]);
  const contactWarn = (field: string) => contactErr?.field === field ? (
    <Text style={[styles.formHint, { color: '#E5484D', marginTop: 6 }]} accessibilityLiveRegion="polite">
      {CONTACT_HIT_LABEL[contactErr.hit]}는 적을 수 없어요. 연락처는 만남 날짜가 정해지면 자동으로 전달돼요
    </Text>
  ) : null;
  // 단계를 넘길 때마다 기기에 저장 (닫지 않고 앱을 나가도 이어서 하도록)
  useEffect(() => {
    if (wizardStep === null || !user) return;
    wizardDraftRef.current = { step: wizardStep, data: profileData };
    AsyncStorage.setItem(`profile_wizard_draft_${user.id}`, JSON.stringify(wizardDraftRef.current)).catch(() => {});
  }, [wizardStep, profileData]);
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
    } else if (open === 'partner') {
      // 파트너 모집 페이지에서 '파트너 신청하기'로 들어오면 신청서를 바로 연다
      setShowConnectorModal(true);
      router.setParams({ open: undefined });
    } else if (open === 'settlements') {
      // 파트너 홈 '출금 가능'에서 들어오면 정산관리를 바로 연다
      setShowSettlementsModal(true);
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
    } else {
      setWizardStep(null);
      setProfileLoaded(false);
    }
  }, [showProfileModal]);

  useEffect(() => {
    if (showBankModal && user) {
      loadBankInfo();
    }
  }, [showBankModal]);

  useEffect(() => {
    if (showConnectorModal && user) {
      setConnectorApplicationStatus(undefined);
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
      // 실제로 통장에 들어간 돈은 출금 신청 → 운영자 이체 완료로 정해진다
      const { data: withdrawals } = await supabase.from('withdrawal_requests').select('*').eq('connector_id', user.id).order('requested_at', { ascending: false });
      setMyWithdrawals(withdrawals || []);
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
        // 서비스 설명은 파트너 소개로 합쳤다 (예전 글은 소개 뒤에 붙여 보여준다)
        const approved = {
          career: connectorData.career || '',
          intro: partnerIntro(connectorData),
          service_description: '',
        };
        // 검수 대기(또는 반려된) 수정본이 있으면 입력칸에는 그것을 보여준다
        const rawPending = (connectorData as any).pending_profile as Partial<typeof approved> | null;
        const pending = rawPending
          ? { ...rawPending, ...('intro' in rawPending || 'service_description' in rawPending ? { intro: partnerIntro({ intro: rawPending.intro ?? connectorData.intro, service_description: rawPending.service_description ?? connectorData.service_description }) } : {}), service_description: '' }
          : null;
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
      .select('location, height, job, education, bio, religion, smoking, drinking, body_type, photo_urls, gender, age')
      .eq('id', user!.id)
      .maybeSingle();
    if (error || !data) return;
    setPhotoUrls(data.photo_urls ?? []);
    setMeBasics({ gender: (data as any).gender ?? null, age: (data as any).age ?? null });
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
      company: '',
      job_category: '',
      district: '',
      extra_conditions: [],
    });
    // 회사·직업 분류·해당 조건은 따로 읽는다 (칸이 없는 DB에서도 프로필은 열리게)
    const { data: comp, error: compErr } = await supabase.from('users').select('company, job_category, extra_conditions').eq('id', user!.id).maybeSingle();
    setCompanyAvailable(!compErr);
    if (!compErr) setProfileData((prev) => ({ ...prev, company: (comp as any)?.company ?? '', job_category: (comp as any)?.job_category ?? '', extra_conditions: (comp as any)?.extra_conditions ?? [] }));
    const { data: dist, error: distErr } = await supabase.from('users').select('district').eq('id', user!.id).maybeSingle();
    setDistrictAvailable(!distErr);
    if (!distErr) setProfileData((prev) => ({ ...prev, district: (dist as any)?.district ?? '' }));
    setProfileLoaded(true);
    // 아직 아무것도 채우지 않았으면 한 질문씩 안내한다 (이미 채운 사람은 한 화면에서 고친다)
    const firstFill = !data.location && !data.job && !data.bio && !(data.photo_urls ?? []).some(Boolean);
    // 기기에 저장해 둔 작성 중 내용 (새로고침·앱 재시작 후에도 이어서)
    let draft = wizardDraftRef.current;
    if (firstFill && !draft) {
      try { const raw = await AsyncStorage.getItem(`profile_wizard_draft_${user!.id}`); draft = raw ? JSON.parse(raw) : null; } catch { draft = null; }
    }
    if (firstFill && draft) {
      setProfileData(draft.data);
      setWizardStep(draft.step);
    } else {
      setWizardStep(firstFill ? 0 : null);
    }
  }

  async function handleProfileSave(): Promise<boolean> {
    // 키는 숫자만, 120~220cm (오타로 17cm처럼 저장되지 않게)
    const h = profileData.height.trim();
    if (h && (!/^\d+$/.test(h) || Number(h) < 120 || Number(h) > 220)) {
      toast.show('키는 120~220 사이 숫자로 입력해 주세요', 'error');
      if (wizardStep !== null) setWizardStep(2);
      return false;
    }
    const hit = findContactIn({ bio: profileData.bio, job: profileData.job, company: companyAvailable ? profileData.company : '' }, ['job', 'company']);
    setContactErr(hit);
    if (hit) {
      toast.show(`${CONTACT_HIT_LABEL[hit.hit]}는 프로필에 적을 수 없어요`, 'error');
      if (wizardStep !== null) setWizardStep(hit.field === 'bio' ? profileSteps - 1 : profileSteps - 4);
      return false;
    }
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
      if (districtAvailable) {
        // 서울·경기가 아니면 구·시는 비운다
        await supabase.from('users').update({ district: DISTRICTS[profileData.location] ? profileData.district || null : null }).eq('id', user!.id);
      }
      if (companyAvailable) {
        const { error: extraErr } = await supabase.from('users').update({
          company: (profileData.company || '').trim() || null,
          job_category: profileData.job_category || null,
          extra_conditions: profileData.extra_conditions || [],
        }).eq('id', user!.id);
        if (extraErr) throw extraErr;
      }

      toast.show('프로필이 저장되었습니다', 'success');
      wizardDraftRef.current = null;
      AsyncStorage.removeItem(`profile_wizard_draft_${user!.id}`).catch(() => {});
      setShowProfileModal(false);
      return true;
    } catch (error) {
      console.error('Profile save error:', error);
      toast.show('프로필 저장 실패', 'error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleStoreSave() {
    if (selectedRegions.length === 0) {
      toast.show('주요지역을 선택해주세요', 'info');
      return;
    }
    const feeValue = Number(feeDigits(storeData.fee_per_session)) || 0;
    if (feeValue < FEE_MIN || feeValue > FEE_MAX) {
      toast.show(`회당 금액은 ${FEE_MIN.toLocaleString()}원 ~ ${FEE_MAX.toLocaleString()}원 사이로 입력해 주세요`, 'error');
      return;
    }

    const text = {
      career: storeData.career.trim(),
      intro: storeData.intro.trim(),
      service_description: '',
    };
    const base = {
      main_region: JSON.stringify(selectedRegions),
      fee_per_session: feeValue,
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
    // 연락처를 적으면 회원이 서비스 밖에서 직접 거래할 수 있어 막는다 (파트너 약관 제3조·제6조)
    const contact = textChanged && !resubmitRejected ? findContactIn({ career: text.career, intro: text.intro }) : null;
    if (contact) {
      toast.show(`소개 글에 ${CONTACT_HIT_LABEL[contact.hit]}는 적을 수 없어요. 회원과는 앱 채팅으로 이야기해 주세요`, 'error');
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
          Object.assign(update, { pending_profile: { ...text, service_description: CLEARED_SERVICE_DESCRIPTION }, profile_status: 'PENDING', profile_reject_reason: null });
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
          .update({ ...base, career: text.career || null, intro: text.intro || null, service_description: CLEARED_SERVICE_DESCRIPTION })
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

  // 탈퇴 시트: 이유(선택)를 고르고 한 번 더 누르면 탈퇴
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReasons, setWithdrawReasons] = useState<string[]>([]);
  const [withdrawMemo, setWithdrawMemo] = useState('');

  async function handleWithdraw() {
    if (!user) return;
    setWithdrawOpen(false);
    setWithdrawing(true);
    try {
      // 탈퇴하면 연결 정보가 지워지므로, 정리할 것(사진·동맹·알림 받은 사람)을 먼저 모아 둔다
      const prep = await prepareWithdraw(user).catch(() => null);
      const result = await withdrawAccount(user.id);
      if (result.ok) {
        await saveWithdrawReason(user, withdrawReasons, withdrawMemo);
        if (prep) await afterWithdraw(prep).catch(() => {});
        // 파트너 신청·활동과 초대 링크도 닫는다 (탈퇴한 사람이 승인되거나 초대장이 열리지 않게). 실패해도 탈퇴는 끝난 것
        await Promise.all([
          supabase.from('connectors').update({ status: 'rejected' }).eq('id', user.id).in('status', ['pending', 'approved']),
          supabase.from('invite_links').update({ is_active: false }).eq('connector_id', user.id),
        ]).catch(() => {});
        await logout({ forget: true });
        router.replace('/');
        toast.show('탈퇴가 완료되었어요. 그동안 이용해주셔서 감사합니다', 'success');
        return;
      }
      if (result.reason === 'in_progress') {
        toast.show(user?.role === 'connector' ? '진행 중인 매칭이 있어요. 매칭 화면에서 마무리하거나 취소한 뒤 탈퇴할 수 있어요' : '진행 중인 소개가 있어요. 홈에서 답하거나, 담당 파트너에게 채팅으로 취소를 요청한 뒤 탈퇴할 수 있어요', 'error');
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

  // 파트너 월간 리포트 시트
  const [showReport, setShowReport] = useState(false);

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

  async function handleRequestWithdrawal(confirmed = false) {
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
    if (!confirmed) {
      setWithdrawConfirm(amount);
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
        toast.show(`✓ 출금을 신청했어요. 영업일 3일 이내 ${bankName} 계좌로 입금돼요`, 'success');
        setWithdrawAmount('');
        setWithdrawConfirm(null);
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
      // 회원으로 소개가 진행 중이면 바꾸지 않는다 (파트너 화면에서는 그 소개에 답할 수 없다)
      const cols = 'id, status, settlement_completed';
      const [{ data: m1 }, { data: m2 }] = await Promise.all([
        supabase.from('match_requests').select(cols).eq('hopeful_1_id', user.id),
        supabase.from('match_requests').select(cols).eq('hopeful_2_id', user.id),
      ]);
      if ([...(m1 || []), ...(m2 || [])].some((m: any) => m.status !== 'rejected' && !m.settlement_completed)) {
        toast.show('진행 중인 소개가 끝나면 파트너 화면으로 바꿀 수 있어요', 'info');
        return;
      }
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

  // 되돌릴 수 있는 동작이라 모달 대신 바텀시트로 확인한다
  const [showSwitchSheet, setShowSwitchSheet] = useState(false);
  const [switching, setSwitching] = useState(false);
  async function handleSwitchToHopeful() {
    if (!user || switching) return;
    setSwitching(true);
    try {
      // 파트너로 진행 중인 매칭이 있으면 바꾸지 않는다 (회원 화면에서는 동의·만남 완료·노쇼 확인을 할 수 없다)
      const cols = 'id, status, settlement_completed';
      const [{ data: c1 }, { data: c2 }] = await Promise.all([
        supabase.from('match_requests').select(cols).eq('connector_1_id', user.id),
        supabase.from('match_requests').select(cols).eq('connector_2_id', user.id),
      ]);
      if ([...(c1 || []), ...(c2 || [])].some((m: any) => m.status !== 'rejected' && !m.settlement_completed)) {
        toast.show('진행 중인 매칭이 끝나면 회원 화면으로 바꿀 수 있어요', 'info');
        setShowSwitchSheet(false);
        return;
      }
      const { error } = await supabase.from('users').update({ role: 'hopeful' }).eq('id', user.id);
      if (error) throw error;
      await updateUser({ role: 'hopeful' });
      setShowSwitchSheet(false);
      toast.show('✓ 회원 화면으로 전환했습니다', 'success');
    } catch (error) {
      console.error('역할 전환 오류:', error);
      toast.show('역할 전환 중 오류가 발생했습니다', 'error');
    } finally {
      setSwitching(false);
    }
  }

  // 심사 중인 파트너 신청을 거둔다 (운영자 심사 목록에서 빠지고, 처음부터 다시 신청할 수 있다)
  async function handleCancelApplication() {
    if (!user || loading) return;
    setLoading(true);
    try {
      const { data: removed, error } = await supabase.from('connectors').delete().eq('id', user.id).eq('status', 'pending').select('id');
      if (error) throw error;
      if (!removed?.length) {
        toast.show('이미 심사가 끝난 신청이에요', 'info');
      } else {
        toast.show('파트너 신청을 취소했어요. 언제든 다시 신청할 수 있어요', 'success');
        setApplyStep(0);
      }
      setShowConnectorModal(false);
      setConnectorApplicationStatus(removed?.length ? null : undefined);
    } catch (error) {
      console.error('신청 취소 오류:', error);
      toast.show('취소하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    } finally {
      setLoading(false);
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
      // 이미 승인된 파트너 기록은 덮어쓰지 않는다 (상태를 불러오기 전에 신청을 누른 경우)
      const { data: existing } = await supabase.from('connectors').select('status').eq('id', user!.id).maybeSingle();
      if (existing?.status === 'approved') {
        setConnectorApplicationStatus('approved');
        toast.show('이미 파트너로 승인되었어요', 'info');
        return;
      }
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
      // 운영자에게 새 신청을 알린다 (정산관리 화면에서 승인)
      const { data: operators } = await supabase.from('users').select('id').eq('role', 'operator');
      await Promise.all((operators || []).map((o: any) => createNotification({
        userId: o.id,
        type: 'partner_applied',
        title: '새 파트너 신청이 들어왔어요',
        body: `${user!.name || '회원'}님 · ${businessName.trim()}`,
        route: '/settlements',
      }).catch(() => {})));
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
          {/* 메뉴는 하는 일에 따라 묶는다: 내 정보 · 소개 설정 · 설정 */}
          <Text style={styles.menuGroup}>내 정보</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
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

          </View></View>
          <Text style={styles.menuGroup}>소개 설정</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
          <PrefsMenuRow styles={styles} />
          <AvoidMenuRow styles={styles} />
          <PauseMenuRow styles={styles} />
          </View></View>
          <Text style={styles.menuGroup}>설정</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
          <PushMenuRow styles={styles} />
          <FeedbackMenuRow styles={styles} />
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowConnectorModal(true)}>
            <Text style={styles.menuIcon}>💼</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>매칭 파트너</Text>
              <Text style={styles.menuSub}>우리 모임 친구들을 소개해 주세요</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          </View></View>
          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
          </>
        )}
        {user?.role === 'connector' && (
          <>
          {/* 메뉴는 하는 일에 따라 묶는다: 회원 모으기 · 수익·정산 · 활동·평판 · 설정 */}
          <Text style={styles.menuGroup}>회원 모으기</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
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

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowStoreModal(true)}>
            <Text style={styles.menuIcon}>🏪</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>커리어 프로필</Text>
              <Text style={styles.menuSub}>회원 정보, 가격, 소개 지역</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          </View></View>
          <Text style={styles.menuGroup}>수익·정산</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowSettlementsModal(true)}>
            <Text style={styles.menuIcon}>💰</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>정산</Text>
              <Text style={styles.menuSub}>이용권 사용 및 지급 내역</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowReport(true)} accessibilityLabel="월간 리포트">
            <Text style={styles.menuIcon}>📊</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>월간 리포트</Text>
              <Text style={styles.menuSub}>이번 달 소개·만남·정산을 한눈에</Text>
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

          </View></View>
          <Text style={styles.menuGroup}>활동·평판</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
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

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowCreditScoreModal(true)}>
            <Text style={styles.menuIcon}>⭐</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>신뢰지표</Text>
              <Text style={styles.menuSub}>등급 및 신뢰 점수</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => router.push({ pathname: '/matching', params: { view: 'ally' } })}>
            <Text style={styles.menuIcon}>🤝</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>동맹 관리</Text>
              <Text style={styles.menuSub}>매칭 › 동맹으로 이동해요</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          </View></View>
          <Text style={styles.menuGroup}>설정</Text>
          <View style={styles.menuCard}><View style={styles.menuCardInner}>
          <AwayMenuRow styles={styles} />
          <PushMenuRow styles={styles} />
          <FeedbackMenuRow styles={styles} />
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowSwitchSheet(true)}>
            <Text style={styles.menuIcon}>🔄</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>역할 전환</Text>
              <Text style={styles.menuSub}>회원 화면으로 이동</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          </View></View>
          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
          </>
        )}
        {user?.role === 'operator' && <Text style={styles.menuGroup}>운영 설정</Text>}
        <View style={user?.role === 'operator' ? styles.menuCard : undefined}><View style={user?.role === 'operator' ? styles.menuCardInner : undefined}>
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
        {user?.role === 'operator' && <BackupMenuRow styles={styles} />}
        {user?.role === 'operator' && <PushMenuRow styles={styles} />}
        </View></View>
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
            <TouchableOpacity onPress={() => { setWithdrawReasons([]); setWithdrawMemo(''); setWithdrawOpen(true); }} disabled={withdrawing} style={styles.policyLink} accessibilityLabel="회원 탈퇴">
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

      {user?.role === 'connector' && <PartnerReportSheet visible={showReport} onClose={() => setShowReport(false)} />}

      <BottomSheet visible={showRefundSheet} onClose={() => { setShowRefundSheet(false); setShowCreditsModal(true); }} title="환불 요청">
        <View style={styles.gradeBox}>
          <Text style={styles.gradeBoxLabel}>환불 예정 금액</Text>
          <Text style={styles.gradeBoxValue}>{(refundable?.total ?? 0).toLocaleString()}원</Text>
          <Text style={styles.gradeBoxScore}>처리 시점의 남은 금액으로 확정돼요</Text>
        </View>
        <Text style={styles.modalLabel}>은행명</Text>
        <TextInput style={styles.modalInput} placeholder="국민은행" placeholderTextColor="#DCD9E2" value={refundBank.bankName}
          onChangeText={(v) => setRefundBank((b) => ({ ...b, bankName: v }))} editable={!requestingRefund} />
        <Text style={styles.modalLabel}>계좌번호</Text>
        <TextInput style={styles.modalInput} placeholder="숫자만 입력" placeholderTextColor="#DCD9E2" value={refundBank.accountNumber}
          onChangeText={(v) => setRefundBank((b) => ({ ...b, accountNumber: v }))} keyboardType="number-pad" editable={!requestingRefund} />
        <Text style={styles.modalLabel}>예금주</Text>
        <TextInput style={styles.modalInput} placeholder="홍길동" placeholderTextColor="#DCD9E2" value={refundBank.accountHolder}
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

      <BottomSheet
        // 불러오는 동안에도 이 시트가 먼저 떠서 로딩을 보여준다 (불러온 뒤 처음이면 단계별, 아니면 수정 화면)
        visible={showProfileModal && (wizardStep !== null || !profileLoaded)}
        onClose={() => {
          if (wizardStep !== null) {
            wizardDraftRef.current = { step: wizardStep, data: profileData };
            AsyncStorage.setItem(`profile_wizard_draft_${user!.id}`, JSON.stringify(wizardDraftRef.current)).catch(() => {});
          }
          setShowProfileModal(false);
          setWizardStep(null);
        }}
        title={wizardStep !== null ? `프로필 채우기 ${wizardStep + 1}/${profileSteps}` : '내 프로필'}
        footer={wizardStep !== null ? (
          <View style={styles.wizardFooter}>
            {wizardStep > 0 && (
              <TouchableOpacity style={styles.wizardPrev} onPress={() => setWizardStep(wizardStep - 1)} accessibilityLabel="이전">
                <Text style={styles.wizardPrevText}>이전</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.wizardNext, (loading || !profileLoaded) && styles.storeSaveBtnDisabled]}
              disabled={loading || !profileLoaded}
              onPress={() => (wizardStep < profileSteps - 1 ? setWizardStep(wizardStep + 1) : handleProfileSave().then((ok) => { if (ok) setWizardStep(null); }))}
              accessibilityLabel={wizardStep < profileSteps - 1 ? '다음' : '저장하기'}
            >
              <Text style={styles.wizardNextText}>{loading ? '저장 중...' : wizardStep < profileSteps - 1 ? '다음' : '저장하기'}</Text>
            </TouchableOpacity>
          </View>
        ) : undefined}
      >
        {!profileLoaded && <ActivityIndicator color="#5B21FF" style={{ marginVertical: 40 }} />}
        {profileLoaded && wizardStep !== null && (() => {
          // 하나만 고르는 질문은 고르면 바로 다음으로 넘어간다
          const pickAndNext = (patch: Partial<typeof profileData>) => {
            setProfileData({ ...profileData, ...patch });
            // 두 번 눌러도 한 칸만 넘어가도록 '지금 단계에서 다음 단계로'만 바꾼다
            const from = wizardStep;
            setTimeout(() => setWizardStep((s) => (s === from && s < profileSteps - 1 ? s + 1 : s)), 250);
          };
          const chips = (options: string[], value: string, onPick: (v: string) => void) => (
            <View style={styles.buttonGroup}>
              {options.map((o) => (
                <TouchableOpacity key={o} style={[styles.optionBtn, value === o && styles.optionBtnSelected]} onPress={() => onPick(o)}>
                  <Text style={[styles.optionBtnText, value === o && styles.optionBtnTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
          const set = (patch: Partial<typeof profileData>) => setProfileData({ ...profileData, ...patch });
          const multiChips = (options: string[], values: string[], onPick: (v: string) => void) => (
            <View style={styles.buttonGroup}>
              {options.map((o) => (
                <TouchableOpacity key={o} style={[styles.optionBtn, values.includes(o) && styles.optionBtnSelected]} onPress={() => onPick(o)} aria-selected={values.includes(o)}>
                  <Text style={[styles.optionBtnText, values.includes(o) && styles.optionBtnTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
          const steps = [
            { title: '사진을 올려 주세요', sub: '사진이 있으면 파트너가 소개하기 훨씬 쉬워요. 나중에 올려도 돼요.', body: user && <PhotoEditor userId={user.id} photos={photoUrls} onChange={setPhotoUrls} /> },
            { title: '어디에 사세요?', sub: '가까운 분 위주로 소개해 드려요.', body: (
              <>
                {/* 서울·경기는 구·시까지 고르면 다음으로 (그 밖의 지역은 바로 다음) */}
                {chips(locations, profileData.location, (v) => (districtAvailable && DISTRICTS[v] ? set({ location: v, district: v === profileData.location ? profileData.district : '' }) : pickAndNext({ location: v, district: '' })))}
                {districtAvailable && !!DISTRICTS[profileData.location] && (
                  <>
                    <Text style={[styles.formLabel, { marginTop: 18 }]}>{profileData.location === '서울' ? '어느 구에 사세요?' : '어느 시·군에 사세요?'}</Text>
                    {chips(DISTRICTS[profileData.location], profileData.district || '', (v) => pickAndNext({ district: v }))}
                  </>
                )}
              </>
            ) },
            { title: '키와 체형을 알려 주세요', body: (
              <>
                <Text style={styles.formLabel}>키 (cm)</Text>
                <TextInput style={[styles.formInput, { marginBottom: 16 }]} placeholder="170" placeholderTextColor="#DCD9E2" keyboardType="number-pad" value={profileData.height} onChangeText={(t) => set({ height: t.replace(/\D/g, '').slice(0, 3) })} />
                <Text style={styles.formLabel}>체형</Text>
                {chips(bodyTypes, profileData.body_type, (v) => set({ body_type: v }))}
              </>
            ) },
            ...(companyAvailable ? [
              { title: '어떤 일을 하세요?', sub: '파트너에게만 보여요.', body: chips(JOB_CATEGORIES, profileData.job_category || '', (v) => pickAndNext({ job_category: v })) },
              { title: '해당하는 조건이 있나요?', sub: '여러 개 고를 수 있어요. 없으면 그냥 다음을 눌러 주세요. 파트너에게만 보여요.', body: multiChips(EXTRA_CONDITIONS, profileData.extra_conditions || [], (v) => set({ extra_conditions: toggleCondition(profileData.extra_conditions || [], v) })) },
            ] : []),
            { title: '하시는 일과 학력은요?', body: (
              <>
                <Text style={styles.formLabel}>직업</Text>
                <TextInput style={[styles.formInput, { marginBottom: 16 }]} placeholder="개발자" placeholderTextColor="#DCD9E2" value={profileData.job} onChangeText={(t) => set({ job: t })} />
                {contactWarn('job')}
                {companyAvailable && (
                  <>
                    <Text style={styles.formLabel}>회사 (선택)</Text>
                    <TextInput style={[styles.formInput, { marginBottom: 4 }]} placeholder="예: 두두전자" placeholderTextColor="#DCD9E2" value={profileData.company ?? ''} onChangeText={(t) => set({ company: t.slice(0, 40) })} accessibilityLabel="회사" />
                    {contactWarn('company')}
                    <Text style={[styles.formHint, { marginBottom: 16 }]}>파트너에게만 보여요. 같은 회사 사람을 소개받지 않게 할 때 써요</Text>
                  </>
                )}
                <Text style={styles.formLabel}>학력</Text>
                {chips(educations, profileData.education, (v) => set({ education: v }))}
              </>
            ) },
            { title: '종교가 있으신가요?', body: chips(religions, profileData.religion, (v) => pickAndNext({ religion: v })) },
            { title: '흡연·음주는 어떠세요?', body: (
              <>
                <Text style={styles.formLabel}>흡연</Text>
                <View style={{ marginBottom: 16 }}>{chips(smokings, profileData.smoking, (v) => set({ smoking: v }))}</View>
                <Text style={styles.formLabel}>음주</Text>
                {chips(drinkings, profileData.drinking, (v) => set({ drinking: v }))}
              </>
            ) },
            { title: '마지막으로, 자기소개를 남겨 주세요', sub: '취미나 주말을 보내는 방법처럼 편하게 적어 주세요.', body: (
              <>
              <TextInput style={[styles.formInput, { minHeight: 120 }]} placeholder="예) 주말엔 등산하고 맛집 찾아다니는 걸 좋아해요" placeholderTextColor="#DCD9E2" multiline value={profileData.bio} onChangeText={(t) => set({ bio: t })} accessibilityLabel="자기소개" />
                {contactWarn('bio')}
                <Text style={[styles.formHint, { marginTop: 6 }]}>연락처·SNS 아이디는 적지 않아도 돼요. 만남 날짜가 정해지면 자동으로 전달돼요</Text>
              </>
            ) },
          ];
          const st = steps[wizardStep];
          return (
            <View style={{ minHeight: 280 }}>
              <View style={styles.wizardProgress}>
                {steps.map((_, i) => <View key={i} style={[styles.wizardDot, i <= wizardStep && styles.wizardDotOn]} />)}
              </View>
              <Text style={styles.wizardTitle}>{st.title}</Text>
              {!!st.sub && <Text style={styles.wizardSub}>{st.sub}</Text>}
              <View style={{ marginTop: 16 }}>{st.body}</View>
            </View>
          );
        })()}
      </BottomSheet>

      <BottomSheet visible={showProfileModal && profileLoaded && wizardStep === null} onClose={() => setShowProfileModal(false)} title="내 프로필 수정">
        {/* 상대 시점 미리보기 + 채운 정도 */}
        {(() => {
          const { pct, missing } = profileFill({ ...profileData, photo_urls: photoUrls }, companyAvailable);
          return (
            <TouchableOpacity style={styles.previewRow} onPress={() => setShowPreview(true)} accessibilityLabel="상대에게 이렇게 보여요">
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>👀 상대에게 이렇게 보여요</Text>
                <Text style={styles.previewSub} numberOfLines={1}>채운 정도 {pct}%{missing.length ? ` · 빠진 것: ${missing.join(', ')}` : ' · 다 채웠어요'}</Text>
                <View style={styles.previewBar}><View style={[styles.previewBarFill, { width: `${pct}%` }]} /></View>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          );
        })()}
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
                onPress={() => setProfileData({ ...profileData, location: loc, district: loc === profileData.location ? profileData.district : '' })}
              >
                <Text style={[styles.optionBtnText, profileData.location === loc && styles.optionBtnTextSelected]}>{loc}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {districtAvailable && !!DISTRICTS[profileData.location] && (
            <>
              <Text style={[styles.formLabel, { marginTop: 14 }]}>{profileData.location === '서울' ? '구' : '시·군'} (선택)</Text>
              <View style={styles.buttonGroup}>
                {DISTRICTS[profileData.location].map((d) => (
                  <TouchableOpacity key={d} style={[styles.optionBtn, profileData.district === d && styles.optionBtnSelected]} onPress={() => setProfileData({ ...profileData, district: profileData.district === d ? '' : d })}>
                    <Text style={[styles.optionBtnText, profileData.district === d && styles.optionBtnTextSelected]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>생년월일</Text>
          <View style={[styles.formInput, {justifyContent: 'center', paddingLeft: 10}]}>
            <Text style={{color: '#322F38', fontSize: 16}}>
              {user?.birth_date || '-'}
            </Text>
          </View>
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>키 (cm)</Text>
          <TextInput
            style={styles.formInput}
            placeholder="170"
            placeholderTextColor="#DCD9E2"
            keyboardType="number-pad"
            value={profileData.height}
            onChangeText={(text) => setProfileData({...profileData, height: text.replace(/\D/g, '').slice(0, 3)})}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>직업</Text>
          <TextInput
            style={styles.formInput}
            placeholder="개발자"
            placeholderTextColor="#DCD9E2"
            value={profileData.job}
            onChangeText={(text) => setProfileData({...profileData, job: text})}
          />
          {contactWarn('job')}
        </View>

        {companyAvailable && (
          <View style={styles.profileFormSection}>
            <Text style={styles.formLabel}>직업 분류</Text>
            <View style={styles.buttonGroup}>
              {JOB_CATEGORIES.map((o) => (
                <TouchableOpacity key={o} style={[styles.optionBtn, profileData.job_category === o && styles.optionBtnSelected]} onPress={() => setProfileData({ ...profileData, job_category: profileData.job_category === o ? '' : o })}>
                  <Text style={[styles.optionBtnText, profileData.job_category === o && styles.optionBtnTextSelected]}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {companyAvailable && (
          <View style={styles.profileFormSection}>
            <Text style={styles.formLabel}>해당하는 조건 (선택 · 여러 개)</Text>
            <View style={styles.buttonGroup}>
              {EXTRA_CONDITIONS.map((o) => {
                const on = (profileData.extra_conditions || []).includes(o);
                return (
                  <TouchableOpacity key={o} style={[styles.optionBtn, on && styles.optionBtnSelected]} onPress={() => setProfileData({ ...profileData, extra_conditions: toggleCondition(profileData.extra_conditions || [], o) })} aria-selected={on}>
                    <Text style={[styles.optionBtnText, on && styles.optionBtnTextSelected]}>{o}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.formHint}>직업 분류와 조건은 파트너에게만 보여요</Text>
          </View>
        )}
        {companyAvailable && (
          <View style={styles.profileFormSection}>
            <Text style={styles.formLabel}>회사 (선택)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="예: 두두전자"
              placeholderTextColor="#DCD9E2"
              value={profileData.company ?? ''}
              onChangeText={(text) => setProfileData({ ...profileData, company: text.slice(0, 40) })}
              accessibilityLabel="회사"
            />
            {contactWarn('company')}
            <Text style={styles.formHint}>파트너에게만 보여요. 같은 회사 사람을 소개받지 않게 할 때 써요</Text>
          </View>
        )}

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
            placeholderTextColor="#DCD9E2"
            multiline
            value={profileData.bio}
            onChangeText={(text) => setProfileData({...profileData, bio: text})}
            accessibilityLabel="자기소개"
          />
          {contactWarn('bio')}
          <Text style={[styles.formHint, { marginTop: 6 }]}>연락처·SNS 아이디는 적지 않아도 돼요. 만남 날짜가 정해지면 자동으로 전달돼요</Text>
        </View>

        <TouchableOpacity
          style={[styles.profileSaveBtn, (loading || !profileLoaded) && styles.storeSaveBtnDisabled]}
          onPress={handleProfileSave}
          disabled={loading || !profileLoaded}
        >
          <Text style={styles.profileSaveBtnText}>{loading ? '저장 중...' : !profileLoaded ? '불러오는 중...' : '저장하기'}</Text>
        </TouchableOpacity>
      </BottomSheet>
      {/* 탈퇴: 되돌릴 수 없어 시트에서 한 번 더 확인. 이유는 선택 (서비스 개선에만 씀) */}
      <BottomSheet visible={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="정말 탈퇴할까요?">
        <Text style={styles.wdLead}>프로필, 사진, 파트너 연결 정보가 삭제되고 되돌릴 수 없어요. 결제·정산 기록은 법에 따라 5년간 보관됩니다.</Text>
        <Text style={styles.wdAsk}>떠나시는 이유를 알려 주시면 더 나은 서비스를 만드는 데 쓸게요 (선택)</Text>
        <View style={styles.buttonGroup}>
          {WITHDRAW_REASONS.map((r) => {
            const on = withdrawReasons.includes(r);
            return (
              <TouchableOpacity key={r} style={[styles.optionBtn, on && styles.optionBtnSelected]} onPress={() => setWithdrawReasons(on ? withdrawReasons.filter((x) => x !== r) : [...withdrawReasons, r])} aria-selected={on} accessibilityLabel={`탈퇴 이유 ${r}`}>
                <Text style={[styles.optionBtnText, on && styles.optionBtnTextSelected]}>{r}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput style={[styles.formInput, { marginTop: 10 }]} value={withdrawMemo} onChangeText={(t) => setWithdrawMemo(t.slice(0, 300))} placeholder="더 하고 싶은 말 (선택)" placeholderTextColor="#BAB7C0" accessibilityLabel="탈퇴 메모" />
        {/* 쉬고 싶은 회원에게는 탈퇴 대신 '잠시 쉬기'를 권한다 */}
        {user?.role === 'hopeful' && withdrawReasons.includes('잠시 쉬고 싶어요') && (
          <View style={styles.wdTip}>
            <Text style={styles.wdTipT}>탈퇴하지 않고 새 소개만 멈출 수도 있어요. 정보와 이용권은 그대로 남아요</Text>
            <TouchableOpacity onPress={() => { setWithdrawOpen(false); toast.show('마이 › 소개 설정 › 소개 잠시 쉬기에서 켤 수 있어요', 'info'); }} accessibilityLabel="탈퇴 대신 잠시 쉬기">
              <Text style={styles.wdTipLink}>탈퇴 대신 잠시 쉬기 ›</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={[styles.wdBtn, withdrawing && { opacity: 0.7 }]} onPress={handleWithdraw} disabled={withdrawing} accessibilityLabel="탈퇴하기">
          {withdrawing ? <ActivityIndicator color="#fff" /> : <Text style={styles.wdBtnT}>탈퇴하기</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* 미리보기: 소개받는 상대가 보는 그대로 (저장 전 내용도 반영) */}
      <BottomSheet visible={showPreview} onClose={() => setShowPreview(false)} title="상대에게 이렇게 보여요">
        {user && (
          <MemberProfileView
            member={{ id: user.id, name: user.name, gender: meBasics.gender ?? undefined, age: meBasics.age ?? undefined, location: profileData.location, height: profileData.height ? Number(profileData.height) : undefined, job: profileData.job, education: profileData.education, bio: profileData.bio, religion: profileData.religion, smoking: profileData.smoking, drinking: profileData.drinking, body_type: profileData.body_type, photo_urls: photoUrls } as any}
          />
        )}
        <Text style={styles.previewNote}>회사·직업 분류·해당 조건·생년월일·원하는 상대는 파트너에게만 보이고, 소개받는 상대에게는 보이지 않아요</Text>
      </BottomSheet>

      <BottomSheet visible={showSwitchSheet} onClose={() => setShowSwitchSheet(false)} title="회원 화면으로 전환할까요?">
        <Text style={{ color: '#65626B', fontSize: 14, lineHeight: 21, marginBottom: 20 }}>
          회원으로 소개를 받을 수 있어요. 마이 › 파트너로 활동하기에서 언제든 파트너 화면으로 돌아올 수 있어요.
        </Text>
        <TouchableOpacity
          style={[styles.modalBtn, styles.modalBtnConfirm, switching && styles.modalBtnDisabled, { flex: 0, minHeight: 50, justifyContent: 'center' }]}
          onPress={handleSwitchToHopeful}
          disabled={switching}
          accessibilityLabel="회원 화면으로 전환"
        >
          {switching ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>회원 화면으로 전환</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <BottomSheet
        visible={showConnectorModal}
        // 닫아도 입력한 단계·모임 이름은 남겨 두고, 다시 열면 이어서 한다
        onClose={() => setShowConnectorModal(false)}
        title={connectorApplicationStatus === 'pending' ? '신청이 접수됐어요' : connectorApplicationStatus === 'approved' ? '매칭 파트너' : `파트너 신청 ${applyStep + 1}/3`}
        footer={applying ? (
          // 신청서는 한 화면에 한 질문씩, 다음 버튼은 아래에 고정
          <View style={styles.wizardFooter}>
            {applyStep > 0 && (
              <TouchableOpacity style={styles.wizardPrev} onPress={() => setApplyStep(applyStep - 1)} accessibilityLabel="이전">
                <Text style={styles.wizardPrevText}>이전</Text>
              </TouchableOpacity>
            )}
            {applyStep < 2 ? (
              <TouchableOpacity
                style={[styles.wizardNext, applyStep === 1 && !businessName.trim() && styles.storeSaveBtnDisabled]}
                disabled={applyStep === 1 && !businessName.trim()}
                onPress={() => setApplyStep(applyStep + 1)}
                accessibilityLabel="다음"
              >
                <Text style={styles.wizardNextText}>{applyStep === 0 ? '시작하기' : '다음'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.wizardNext, (loading || !partnerConsents.includes('partner')) && styles.storeSaveBtnDisabled]}
                onPress={handleConnectorSignup}
                disabled={loading || !partnerConsents.includes('partner')}
                accessibilityLabel="신청하기"
              >
                <Text style={styles.wizardNextText}>{loading ? '신청 중...' : '신청하기'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : undefined}
      >
            {connectorApplicationStatus === undefined ? (
              <ActivityIndicator color="#5B21FF" style={{ marginVertical: 32 }} />
            ) : connectorApplicationStatus === 'approved' ? (
              <>
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
                {/* 접수 후: 지금 어디까지 왔고, 기다리는 동안 무엇을 준비하면 되는지 */}
                {[
                  { t: '신청 완료', d: '모임 이름과 약관 동의를 받았어요', done: true },
                  { t: '운영자 확인', d: '확인되면 알림으로 바로 알려드려요', done: false },
                  { t: '파트너 시작', d: '승인되면 마이에서 파트너 화면으로 바뀌어요', done: false },
                ].map((st, i) => (
                  <View key={st.t} style={styles.applyTimelineRow}>
                    <View style={[styles.applyTimelineDot, st.done && styles.wizardDotOn]}>
                      <Text style={styles.applyTimelineNum}>{st.done ? '✓' : i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.applyTimelineTitle}>{st.t}</Text>
                      <Text style={styles.applyTimelineDesc}>{st.d}</Text>
                    </View>
                  </View>
                ))}
                <View style={styles.partnerIntro}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#322F38', marginBottom: 4 }}>기다리는 동안 준비해 두세요</Text>
                  <Text style={{ fontSize: 13, color: '#54515A', lineHeight: 20 }}>· 한 번 소개에 받을 금액{'\n'}· 소개할 지역{'\n'}· 회원에게 보여 줄 소개 글과 사진</Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnConfirm]}
                  onPress={() => setShowConnectorModal(false)}
                >
                  <Text style={styles.modalBtnText}>확인</Text>
                </TouchableOpacity>
                {/* 심사 전이면 신청을 거둘 수 있다 (언제든 다시 신청 가능) */}
                <TouchableOpacity style={styles.applyCancel} onPress={handleCancelApplication} disabled={loading} accessibilityLabel="파트너 신청 취소">
                  {loading ? <ActivityIndicator color="#87848D" /> : <Text style={styles.applyCancelText}>신청 취소</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ minHeight: 260 }}>
                <View style={styles.wizardProgress}>
                  {[0, 1, 2].map((i) => <View key={i} style={[styles.wizardDot, i <= applyStep && styles.wizardDotOn]} />)}
                </View>
                {connectorApplicationStatus === 'rejected' && applyStep === 0 && (
                  <Text style={{ color: '#E53935', fontSize: 12, marginBottom: 10 }}>
                    이전 신청이 반려되었어요. 다시 신청할 수 있어요.
                  </Text>
                )}
                {applyStep === 0 && (
                  <>
                    <Text style={styles.wizardTitle}>모임 대표라면{'\n'}파트너로 활동해 보세요</Text>
                    <View style={{ marginTop: 16, gap: 12 }}>
                      {[
                        ['🤝', '우리 모임 친구를 다른 모임 친구와 이어 줘요'],
                        ['💰', '소개가 성사될 때마다 소개비를 받아요'],
                        ['📄', '사업자가 없어도 시작할 수 있어요'],
                      ].map(([icon, text]) => (
                        <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={{ fontSize: 20 }}>{icon}</Text>
                          <Text style={{ flex: 1, fontSize: 14, color: '#434049' }}>{text}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
                {applyStep === 1 && (
                  <>
                    <Text style={styles.wizardTitle}>모임 이름을 알려 주세요</Text>
                    <Text style={styles.wizardSub}>회원에게 보이는 이름이에요.</Text>
                    <TextInput
                      style={[styles.modalInput, { marginTop: 16 }]}
                      placeholder="예: 행복매칭, 판교 러닝크루"
                      placeholderTextColor="#DCD9E2"
                      value={businessName}
                      onChangeText={setBusinessName}
                      editable={!loading}
                      autoFocus
                    />
                  </>
                )}
                {applyStep === 2 && (
                  <>
                    <Text style={styles.wizardTitle}>약관에 동의해 주세요</Text>
                    <Text style={styles.wizardSub}>신청하면 운영자가 확인한 뒤 알려드려요.</Text>
                    <View style={{ marginTop: 16 }}>
                      <ConsentChecklist items={PARTNER_CONSENTS} checked={partnerConsents} onChange={setPartnerConsents} disabled={loading} />
                    </View>
                  </>
                )}
              </View>
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
          <Text style={styles.formLabel}>회당 금액 (원)</Text>
          <TextInput
            style={styles.formInput}
            placeholder="예: 50,000"
            placeholderTextColor="#DCD9E2"
            keyboardType="number-pad"
            // 3자리마다 쉼표를 넣어 보여주고, 저장은 숫자만
            value={feeDigits(storeData.fee_per_session) ? Number(feeDigits(storeData.fee_per_session)).toLocaleString('ko-KR') : ''}
            onChangeText={(text) => setStoreData({ ...storeData, fee_per_session: feeDigits(text).slice(0, 8) })}
            accessibilityLabel="회당 금액"
          />
          {(() => {
            const fee = Number(feeDigits(storeData.fee_per_session)) || 0;
            if (!fee) return null;
            if (fee < FEE_MIN || fee > FEE_MAX) return <Text style={[styles.formHint, { color: '#E5484D' }]}>{FEE_MIN.toLocaleString()}원 ~ {FEE_MAX.toLocaleString()}원 사이로 입력해 주세요</Text>;
            if (fee < 10000 || fee > 500000) return <Text style={styles.formHint}>1회 {fee.toLocaleString()}원 · 보통보다 {fee < 10000 ? '낮은' : '높은'} 금액이에요. 맞는지 한 번 더 확인해 주세요</Text>;
            return null;
          })()}
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
          <Text style={styles.formLabel}>경력</Text>
          <TextInput
            style={styles.formInput}
            placeholder="예: 결혼정보회사 커플매니저 5년"
            placeholderTextColor="#DCD9E2"
            value={storeData.career}
            onChangeText={(text) => setStoreData({ ...storeData, career: text })}
            maxLength={60}
          />
        </View>

        <View style={styles.profileFormSection}>
          <Text style={styles.formLabel}>파트너 소개</Text>
          <TextInput
            style={[styles.formInput, { height: 100, textAlignVertical: 'top' }]}
            placeholder="어떤 분들을 주로 소개하는지, 소개 방식과 진행 과정, 회원에게 하고 싶은 말을 적어주세요"
            placeholderTextColor="#DCD9E2"
            multiline
            numberOfLines={5}
            value={storeData.intro}
            onChangeText={(text) => setStoreData({ ...storeData, intro: text })}
            maxLength={1000}
          />
          <Text style={styles.formHint}>회원이 파트너 정보에서 가입 여부를 정할 때 보는 내용이에요. 경력·소개는 운영자 확인 후 공개되고, '보장·100%·확실' 같은 과장 표현은 쓸 수 없어요.</Text>
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
          <Text style={{ color: '#98959E', paddingVertical: 20 }}>불러오는 중...</Text>
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
                <Text style={{ color: '#98959E', paddingVertical: 12 }}>아직 구매한 이용권이 없습니다. 파트너 탭에서 가입이 승인된 파트너의 이용권을 구매해보세요.</Text>
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
                    {c.freeReceived > 0 && (
                      <Text style={styles.freeNote}>🎁 선물받은 무료 이용권 {c.freeReceived}회 · {c.freeAvailable > 0 ? '먼저 사용돼요' : '사용함'}</Text>
                    )}
                    {c.refunded > 0 && <Text style={styles.refundedNote}>환불 {c.refunded}회</Text>}
                    <TouchableOpacity
                      style={styles.creditBuyBtn}
                      onPress={() => { setShowCreditsModal(false); router.push({ pathname: '/connectors', params: { open: c.connectorId, buy: '1' } }); }}
                      accessibilityLabel={`${c.connectorName} 이용권 구매하기`}
                    >
                      <Text style={styles.creditBuyBtnText}>이용권 구매하기 ›</Text>
                    </TouchableOpacity>
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
          <Text style={{ color: '#98959E', paddingVertical: 20 }}>불러오는 중...</Text>
        ) : mySettlements.length === 0 ? (
          <Text style={{ color: '#98959E', paddingVertical: 20 }}>정산 내역이 없습니다</Text>
        ) : (
          <>
            {(() => {
              const earned = mySettlements.reduce((sum, s) => sum + Number(s.connector_payout), 0);
              const paidOut = myWithdrawals.filter((w) => w.status === 'completed').reduce((sum, w) => sum + Number(w.amount), 0);
              const inProgress = myWithdrawals.filter((w) => w.status !== 'completed').reduce((sum, w) => sum + Number(w.amount), 0);
              const available = Math.max(0, earned - paidOut - inProgress);
              return (
                <>
                  <View style={styles.statsContainer}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>쌓인 정산금</Text>
                      <Text style={[styles.statValue, moneyFit(earned)]} numberOfLines={1}>{earned.toLocaleString()}원</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>내 통장 입금</Text>
                      <Text style={[styles.statValue, moneyFit(paidOut)]} numberOfLines={1}>{paidOut.toLocaleString()}원</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>출금 가능</Text>
                      <Text style={[styles.statValue, moneyFit(available), { color: '#5B21FF' }]} numberOfLines={1}>{available.toLocaleString()}원</Text>
                    </View>
                  </View>
                  {available > 0 && (
                    <TouchableOpacity
                      style={styles.payoutBtn}
                      onPress={() => { setShowSettlementsModal(false); setShowBankModal(true); }}
                      accessibilityLabel="출금 신청하러 가기"
                    >
                      <Text style={styles.payoutBtnText}>{available.toLocaleString()}원 출금 신청하기</Text>
                    </TouchableOpacity>
                  )}
                  {inProgress > 0 && <Text style={styles.chargeNotice}>입금 준비 중: {inProgress.toLocaleString()}원 (운영자가 이체하면 '내 통장 입금'으로 옮겨져요)</Text>}
                  <Text style={[styles.chargeNotice, { marginBottom: 20 }]}>만남이 끝날 때마다 정산금이 쌓이고, 출금 신청을 해야 통장으로 들어와요.</Text>
                </>
              );
            })()}

            <View style={styles.modalSection}>
              <Text style={styles.modalSectionTitle}>이용권 사용 내역</Text>
              {mySettlements.map((s) => (
                <View key={s.id} style={styles.creditCard}>
                  <View style={styles.creditCardHeader}>
                    <Text style={styles.creditConnectorName}>{s.hopefulName}님</Text>
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
                        ✓ {s.settled_at ? new Date(s.settled_at).toLocaleDateString('ko-KR') : ''} 정산금 적립
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
          <Text style={{ color: '#98959E', paddingVertical: 20 }}>신뢰지표를 불러오지 못했습니다</Text>
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

      <BottomSheet visible={showBankModal} onClose={() => { setShowBankModal(false); setWithdrawConfirm(null); }} title={withdrawConfirm !== null ? '출금 확인' : '계좌 정보'}>

        {loadingBank ? (
          <ActivityIndicator size="large" color="#5B21FF" style={{ marginTop: 40 }} />
        ) : withdrawConfirm !== null ? (
          <>
            <Text style={styles.wizardTitle}>{withdrawConfirm.toLocaleString()}원을{'\n'}출금할까요?</Text>
            <View style={[styles.gradeBox, { marginTop: 20, alignItems: 'stretch', paddingHorizontal: 16, paddingVertical: 12 }]}>
              {[
                ['받는 계좌', `${bankName} ${accountNumber}`],
                ['예금주', accountHolder],
                ['입금 예정', '영업일 3일 이내'],
                ['출금 후 남는 금액', `${(availableBalance - withdrawConfirm).toLocaleString()}원`],
              ].map(([k, v]) => (
                <View key={k} style={styles.withdrawRow}>
                  <Text style={styles.withdrawKey}>{k}</Text>
                  <Text style={styles.withdrawVal}>{v}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.wizardFooter, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.wizardPrev} onPress={() => setWithdrawConfirm(null)} disabled={requestingWithdrawal}>
                <Text style={styles.wizardPrevText}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.wizardNext, requestingWithdrawal && styles.storeSaveBtnDisabled]} onPress={() => handleRequestWithdrawal(true)} disabled={requestingWithdrawal} accessibilityLabel="출금 신청 확정">
                {requestingWithdrawal ? <ActivityIndicator color="#fff" /> : <Text style={styles.wizardNextText}>출금 신청</Text>}
              </TouchableOpacity>
            </View>
          </>
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
                placeholderTextColor="#DCD9E2"
                value={bankName}
                onChangeText={setBankName}
                editable={!savingBank}
              />
              <Text style={styles.modalLabel}>계좌번호</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="숫자만 입력"
                placeholderTextColor="#DCD9E2"
                value={accountNumber}
                onChangeText={setAccountNumber}
                editable={!savingBank}
                keyboardType="number-pad"
              />
              <Text style={styles.modalLabel}>예금주</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="홍길동"
                placeholderTextColor="#DCD9E2"
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
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={[styles.modalInput, { flex: 1 }]}
                  placeholder="출금할 금액"
                  placeholderTextColor="#DCD9E2"
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  editable={!requestingWithdrawal}
                  keyboardType="number-pad"
                />
                <TouchableOpacity style={styles.allAmountBtn} onPress={() => setWithdrawAmount(String(availableBalance))} accessibilityLabel="전액 입력">
                  <Text style={styles.allAmountBtnText}>전액</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, requestingWithdrawal && styles.modalBtnDisabled, { marginTop: 12 }]}
                onPress={() => handleRequestWithdrawal()}
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
                        <Text style={styles.pendingBadgeText}>처리 중 · 영업일 3일 이내 입금</Text>
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

// 금액 칸이 좁아 '원'이 다음 줄로 넘어가지 않도록, 자릿수가 길면 글자를 줄인다
function moneyFit(n: number) {
  const len = `${n.toLocaleString()}원`.length;
  return { fontSize: len <= 6 ? 18 : len <= 9 ? 15 : 13 };
}

const PROFILE_STEPS_BASE = 7;
const styles = StyleSheet.create({
  wizardFooter: { flexDirection: 'row', gap: 8 },
  applyCancel: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, marginTop: 4 },
  applyCancelText: { fontSize: 13, color: '#87848D', textDecorationLine: 'underline' },
  withdrawRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  withdrawKey: { fontSize: 13, color: '#87848D' },
  withdrawVal: { fontSize: 14, fontWeight: '600', color: '#211E27', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  allAmountBtn: { paddingHorizontal: 14, height: 44, borderRadius: 10, backgroundColor: '#F1ECFF', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  allAmountBtnText: { fontSize: 14, fontWeight: '700', color: '#5B21FF' },
  applyTimelineRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  applyTimelineDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#DCD9E2', alignItems: 'center', justifyContent: 'center' },
  applyTimelineNum: { color: '#fff', fontSize: 12, fontWeight: '700' },
  applyTimelineTitle: { fontSize: 14, fontWeight: '700', color: '#211E27' },
  applyTimelineDesc: { fontSize: 12, color: '#87848D', marginTop: 2 },
  wizardPrev: { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#F1EFF4', alignItems: 'center', justifyContent: 'center' },
  wizardPrevText: { fontSize: 15, fontWeight: '700', color: '#54515A' },
  wizardNext: { flex: 2.4, height: 52, borderRadius: 12, backgroundColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  wizardNextText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  wizardProgress: { flexDirection: 'row', gap: 4, marginBottom: 20 },
  wizardDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#EDEBF0' },
  wizardDotOn: { backgroundColor: '#5B21FF' },
  wizardTitle: { fontSize: 22, fontWeight: '700', color: '#211E27', lineHeight: 30 },
  wizardSub: { fontSize: 14, color: '#87848D', marginTop: 6, lineHeight: 20 },
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
    color: '#322F38',
    marginBottom: 0,
  },
  buildId: {
    textAlign: 'center',
    fontSize: 11,
    color: '#BAB7C0',
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
    color: '#98959E',
    textDecorationLine: 'underline',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EFF4',
  },
  scoreRowText: {
    flex: 1,
    marginRight: 12,
  },
  scoreBasis: {
    fontSize: 12,
    color: '#98959E',
    marginTop: 2,
  },
  scoreHint: {
    fontSize: 12,
    color: '#98959E',
    marginTop: 10,
    lineHeight: 18,
  },
  grade: {
    fontSize: 1,
    color: '#98959E',
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
  partnerIntro: { fontSize: 14, color: '#434049', lineHeight: 21, backgroundColor: '#F7F4FF', borderRadius: 12, padding: 14, marginBottom: 16 },
  freeNote: { fontSize: 12, color: '#5B21FF', marginTop: 8 },
  creditBuyBtn: { marginTop: 10, alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 2 },
  creditBuyBtnText: { color: '#65626B', fontSize: 13, textDecorationLine: 'underline' },
  reviewBanner: { backgroundColor: '#F7F4FF', borderRadius: 12, padding: 12, marginBottom: 12 },
  reviewBannerRejected: { backgroundColor: '#FFF1F0' },
  reviewBannerTitle: { fontSize: 14, fontWeight: '700', color: '#5B21FF' },
  reviewBannerText: { fontSize: 13, color: '#54515A', marginTop: 4, lineHeight: 19 },
  inviteItem: { backgroundColor: '#F1ECFF' },
  newBadge: { backgroundColor: '#5B21FF', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  newBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  wdLead: { fontSize: 14, color: '#434049', lineHeight: 21, marginBottom: 14 },
  wdAsk: { fontSize: 13, color: '#65626B', fontWeight: '600', marginBottom: 8 },
  wdTip: { backgroundColor: '#F7F4FF', borderRadius: 12, padding: 12, marginTop: 12, gap: 6 },
  wdTipT: { fontSize: 13, color: '#434049', lineHeight: 19 },
  wdTipLink: { fontSize: 13, color: '#5B21FF', fontWeight: '700' },
  wdBtn: { height: 50, borderRadius: 12, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  wdBtnT: { fontSize: 15, fontWeight: '700', color: '#fff' },
  previewRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F7F4FF', borderRadius: 14, padding: 14, marginBottom: 18 },
  previewTitle: { fontSize: 15, fontWeight: '700', color: '#322F38' },
  previewSub: { fontSize: 12, color: '#65626B', marginTop: 3 },
  previewBar: { height: 6, borderRadius: 3, backgroundColor: '#E6DEFF', marginTop: 8, overflow: 'hidden' },
  previewBarFill: { height: 6, borderRadius: 3, backgroundColor: '#5B21FF' },
  previewNote: { fontSize: 12, color: '#98959E', lineHeight: 18, marginTop: 12 },
  menuGroup: { fontSize: 13, fontWeight: '700', color: '#87848D', marginTop: 12, marginBottom: 8, marginLeft: 4 },
  // 묶음 카드 안의 한 줄 (줄 사이는 얇은 선, 마지막 줄 선은 카드가 가린다)
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEDF2',
  },
  menuCard: { backgroundColor: '#F9F7FC', borderRadius: 16, overflow: 'hidden', marginBottom: 8 },
  menuCardInner: { marginBottom: -1 },
  menuIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: { fontSize: 15, fontWeight: '700', color: '#322F38', marginBottom: 2 },
  menuSub: { fontSize: 12, color: '#87848D' },
  arrow: { fontSize: 18, color: '#DCD9E2', fontWeight: '300', marginLeft: 8 },
  logoutMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 12,
    marginTop: 12,
    backgroundColor: '#F9F7FC',
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
    color: '#322F38',
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#65626B',
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#DCD9E2',
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
    borderColor: '#DCD9E2',
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
    color: '#65626B',
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
    color: '#98959E',
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
    color: '#65626B',
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
    color: '#322F38',
    marginBottom: 8,
  },
  comingSoonSub: {
    fontSize: 13,
    color: '#98959E',
    textAlign: 'center',
    lineHeight: 20,
  },
  profileModalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#322F38',
    marginBottom: 20,
  },
  profileFormSection: {
    marginBottom: 16,
  },
  formHint: {
    fontSize: 12,
    color: '#98959E',
    marginTop: 6,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#65626B',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#DCD9E2',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#322F38',
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
    borderColor: '#DCD9E2',
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
    color: '#65626B',
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
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8E0FF',
  },
  statLabel: {
    fontSize: 11,
    color: '#98959E',
    marginBottom: 6,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5B21FF',
  },
  creditCard: {
    backgroundColor: '#F8F6FB',
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
    backgroundColor: '#F3F1F6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  pendingBadgeText: {
    color: '#87848D',
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
    color: '#322F38',
  },
  creditFee: {
    fontSize: 12,
    color: '#98959E',
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
    borderColor: '#EDEBF0',
  },
  creditStatLabel: {
    fontSize: 11,
    color: '#98959E',
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
    color: '#98959E',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#65626B',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#322F38',
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
    color: '#65626B',
    marginBottom: 6,
  },
  walletBalanceValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5B21FF',
  },
  refundedNote: {
    fontSize: 12,
    color: '#98959E',
    marginTop: 8,
  },
  refundHint: {
    fontSize: 12,
    color: '#87848D',
    lineHeight: 18,
    marginTop: 6,
  },
  refundBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#DCD9E2',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  refundBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#434049',
  },
  refundPendingBox: {
    backgroundColor: '#F6F4F9',
    borderRadius: 10,
    padding: 14,
  },
  refundPendingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#322F38',
  },
  payoutBtn: { backgroundColor: '#5B21FF', borderRadius: 12, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  payoutBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  chargeNotice: {
    fontSize: 11,
    color: '#98959E',
    textAlign: 'center',
    marginTop: 10,
  },
  modalSection: {
    marginBottom: 28,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#322F38',
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
