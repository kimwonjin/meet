import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, Alert, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { getMyConnectorCredits, chargeWallet, getWalletBalance, CHARGE_OPTIONS } from '@/lib/payments';
import NotificationBell from '@/components/NotificationBell';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUser } = useAuth();
  const toast = useToast();
  const [showConnectorModal, setShowConnectorModal] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [connectorApplicationStatus, setConnectorApplicationStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [showSettlementsModal, setShowSettlementsModal] = useState(false);
  const [showCreditScoreModal, setShowCreditScoreModal] = useState(false);
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
  });
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);

  const locations = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주'];

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
        hopefulName: (hopefulUsers || []).find((u: any) => u.id === s.hopeful_id)?.name || '희망자',
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
      const [{ data: credits, error }, { balance }] = await Promise.all([
        getMyConnectorCredits(user.id),
        getWalletBalance(user.id),
      ]);
      if (error) throw error;

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
      const { data: connectorData } = await supabase
        .from('connectors')
        .select('main_region, fee_per_session, service_description')
        .eq('id', user.id)
        .single();

      if (connectorData) {
        try {
          const regions = connectorData.main_region ? JSON.parse(connectorData.main_region) : [];
          setSelectedRegions(Array.isArray(regions) ? regions : []);
        } catch {
          setSelectedRegions([]);
        }
        setStoreData((prev) => ({
          ...prev,
          main_region: connectorData.main_region || '',
          fee_per_session: connectorData.fee_per_session || '',
          service_description: connectorData.service_description || '',
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

      // 매칭 수 계산 (상태가 completed인 매칭)
      const { data: completedMatches } = await supabase
        .from('match_requests')
        .select('id')
        .or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`)
        .eq('status', 'completed');

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
    const { data, error } = await supabase
      .from('users')
      .select('location, height, job, education, bio, religion, smoking, drinking, body_type')
      .eq('id', user!.id)
      .maybeSingle();
    if (error || !data) return;
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

      Alert.alert('성공', '프로필이 저장되었습니다');
      setShowProfileModal(false);
    } catch (error) {
      console.error('Profile save error:', error);
      Alert.alert('오류', '프로필 저장 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleStoreSave() {
    if (selectedRegions.length === 0) {
      Alert.alert('알림', '주요지역을 선택해주세요');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('connectors')
        .update({
          main_region: JSON.stringify(selectedRegions),
          fee_per_session: parseInt(storeData.fee_per_session) || null,
          service_description: storeData.service_description,
        })
        .eq('id', user!.id);

      if (error) throw error;

      Alert.alert('성공', '스토어 정보가 저장되었습니다');
      setShowStoreModal(false);
    } catch (error) {
      console.error('Store save error:', error);
      Alert.alert('오류', '저장 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      router.replace('/');
    } catch (error) {
      console.error('로그아웃 오류:', error);
      Alert.alert('오류', '로그아웃 중 오류가 발생했습니다');
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
    if (!user) return;
    const amount = parseInt(withdrawAmount, 10);
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
      const { error } = await supabase.from('withdrawal_requests').insert({
        connector_id: user.id,
        amount,
        bank_name: bankName,
        account_number: accountNumber,
        account_holder: accountHolder,
      });
      if (error) throw error;
      toast.show('✓ 출금을 신청했습니다', 'success');
      setWithdrawAmount('');
      await loadBankInfo();
    } catch (error) {
      console.error('출금 신청 오류:', error);
      toast.show('출금 신청 중 오류가 발생했습니다', 'error');
    } finally {
      setRequestingWithdrawal(false);
    }
  }

  async function handleSwitchToHopeful() {
    if (!user) return;
    try {
      const { error } = await supabase.from('users').update({ role: 'hopeful' }).eq('id', user.id);
      if (error) throw error;
      await updateUser({ role: 'hopeful' });
      toast.show('✓ 희망자 화면으로 전환했습니다', 'success');
    } catch (error) {
      console.error('역할 전환 오류:', error);
      toast.show('역할 전환 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleConnectorSignup() {
    if (!businessName.trim()) {
      Alert.alert('오류', '회사명을 입력해주세요');
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

      setConnectorApplicationStatus('pending');
      toast.show('✓ 매칭 파트너 심사를 신청했습니다', 'success');
      setBusinessName('');
    } catch (error) {
      console.error('Connector signup error:', error);
      Alert.alert('오류', `파트너 신청 실패: ${error}`);
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
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>👤</Text>
        </View>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.grade}>{user?.grade || 'new'}</Text>
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

          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuIcon}>⭐</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>신뢰지표</Text>
              <Text style={styles.menuSub}>나의 신뢰 점수</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowCreditsModal(true)}>
            <Text style={styles.menuIcon}>💳</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>이용권/결제</Text>
              <Text style={styles.menuSub}>이용권 및 정산</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Text style={styles.menuIcon}>⚙️</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>설정</Text>
              <Text style={styles.menuSub}>앱 설정 및 알림</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowConnectorModal(true)}>
            <Text style={styles.menuIcon}>💼</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>매칭 파트너</Text>
              <Text style={styles.menuSub}>파트너로 활동하기</Text>
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
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowSettlementsModal(true)}>
            <Text style={styles.menuIcon}>💰</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>정산</Text>
              <Text style={styles.menuSub}>이용권 사용 및 지급 내역</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setShowCreditScoreModal(true)}>
            <Text style={styles.menuIcon}>⭐</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>신용지표</Text>
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
              <Text style={styles.menuSub}>희망자 화면으로 이동</Text>
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
          <TouchableOpacity style={styles.logoutMenuItem} onPress={handleLogout}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        )}
        </View>
      </ScrollView>

      <Modal visible={showProfileModal} transparent animationType="slide">
        <View style={styles.modalContainer}>
          <ScrollView style={styles.profileModalContent} showsVerticalScrollIndicator={false}>
            <TouchableOpacity onPress={() => setShowProfileModal(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.profileModalTitle}>내 프로필 수정</Text>

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
              style={[styles.profileSaveBtn, loading && styles.storeSaveBtnDisabled]}
              onPress={handleProfileSave}
              disabled={loading}
            >
              <Text style={styles.profileSaveBtnText}>{loading ? '저장 중...' : '저장하기'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showConnectorModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {connectorApplicationStatus === 'pending' ? (
              <>
                <Text style={styles.modalTitle}>심사 중입니다</Text>
                <Text style={{ color: '#666', fontSize: 13, marginBottom: 20, lineHeight: 20 }}>
                  매칭 파트너 신청이 접수되었습니다.{'\n'}운영자 승인 후 파트너 화면이 열립니다.
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
                <Text style={styles.modalTitle}>매칭 파트너 신청</Text>
                {connectorApplicationStatus === 'rejected' && (
                  <Text style={{ color: '#E53935', fontSize: 12, marginBottom: 10 }}>
                    이전 신청이 반려되었습니다. 다시 신청할 수 있습니다.
                  </Text>
                )}
                <Text style={styles.modalLabel}>회사명</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="홍길동"
                  placeholderTextColor="#ddd"
                  value={businessName}
                  onChangeText={setBusinessName}
                  editable={!loading}
                />
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
                    style={[styles.modalBtn, styles.modalBtnConfirm, loading && styles.modalBtnDisabled]}
                    onPress={handleConnectorSignup}
                    disabled={loading}
                  >
                    <Text style={styles.modalBtnText}>{loading ? '신청 중...' : '심사 신청하기'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* 스토어관리 모달 */}
      <Modal visible={showStoreModal} transparent animationType="slide">
        <SafeAreaView style={styles.container}>
          <TouchableOpacity onPress={() => setShowStoreModal(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>

          <Text style={styles.profileModalTitle}>스토어관리</Text>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showCreditsModal} transparent animationType="slide" onRequestClose={() => setShowCreditsModal(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setShowCreditsModal(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={styles.profileModalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.profileModalTitle}>이용권/결제</Text>

            {loadingCredits ? (
              <Text style={{ color: '#999', paddingVertical: 20 }}>불러오는 중...</Text>
            ) : (
              <>
                <View style={styles.walletBalanceBox}>
                  <Text style={styles.walletBalanceLabel}>충전된 금액</Text>
                  <Text style={styles.walletBalanceValue}>{walletBalance.toLocaleString()}원</Text>
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
                  <Text style={styles.chargeNotice}>카드결제는 추후 지원 예정입니다 (현재는 테스트 충전)</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>이용권 현황</Text>
                  {myConnectorCredits.length === 0 ? (
                    <Text style={{ color: '#999', paddingVertical: 12 }}>아직 구매한 이용권이 없습니다. 파트너 탭에서 승인된 연결자의 이용권을 구매해보세요.</Text>
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
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showSettlementsModal} transparent animationType="slide" onRequestClose={() => setShowSettlementsModal(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setShowSettlementsModal(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={styles.profileModalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.profileModalTitle}>정산관리</Text>

            {loadingSettlements ? (
              <Text style={{ color: '#999', paddingVertical: 20 }}>불러오는 중...</Text>
            ) : mySettlements.length === 0 ? (
              <Text style={{ color: '#999', paddingVertical: 20 }}>정산 내역이 없습니다</Text>
            ) : (
              <>
                <View style={styles.statsContainer}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>총 지급액</Text>
                    <Text style={styles.statValue}>
                      {mySettlements.reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>지급완료</Text>
                    <Text style={styles.statValue}>
                      {mySettlements.filter((s) => s.status === 'paid').reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>지급 대기중</Text>
                    <Text style={styles.statValue}>
                      {mySettlements.filter((s) => s.status === 'pending').reduce((sum, s) => sum + Number(s.connector_payout), 0).toLocaleString()}원
                    </Text>
                  </View>
                </View>

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
                            ✓ {s.settled_at ? new Date(s.settled_at).toLocaleDateString('ko-KR') : ''} 지급 완료
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.pendingBadge}>
                          <Text style={styles.pendingBadgeText}>지급 대기중</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showCreditScoreModal} transparent animationType="slide" onRequestClose={() => setShowCreditScoreModal(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setShowCreditScoreModal(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={styles.profileModalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.profileModalTitle}>신용지표</Text>

            {loadingCreditScore ? (
              <ActivityIndicator size="large" color="#5B21FF" style={{ marginTop: 40 }} />
            ) : !creditScore ? (
              <Text style={{ color: '#999', paddingVertical: 20 }}>신용지표를 불러오지 못했습니다</Text>
            ) : creditScore.total_proposed === 0 ? (
              <View style={styles.comingSoonContainer}>
                <Text style={styles.comingSoonIcon}>⭐</Text>
                <Text style={styles.comingSoonText}>아직 제안한 매칭이 없습니다</Text>
                <Text style={styles.comingSoonSub}>매칭을 진행하면 등급이 산정됩니다</Text>
              </View>
            ) : (
              <>
                <View style={styles.gradeBox}>
                  <Text style={styles.gradeBoxLabel}>현재 등급</Text>
                  <Text style={styles.gradeBoxValue}>{creditScore.grade}</Text>
                  <Text style={styles.gradeBoxScore}>종합 점수 {creditScore.overall_score}점</Text>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>세부 점수</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>매칭 성사율</Text>
                    <Text style={styles.infoValue}>{creditScore.success_score}점</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>노쇼·분쟁 없음</Text>
                    <Text style={styles.infoValue}>{creditScore.trust_score}점</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>활동량</Text>
                    <Text style={styles.infoValue}>{creditScore.activity_score}점</Text>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>근거 데이터</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>제안한 매칭</Text>
                    <Text style={styles.infoValue}>{creditScore.total_proposed}건</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>정산 완료</Text>
                    <Text style={styles.infoValue}>{creditScore.settled_count}건</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>노쇼·분쟁 신고</Text>
                    <Text style={styles.infoValue}>{creditScore.noshow_dispute_count}건</Text>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showBankModal} transparent animationType="slide" onRequestClose={() => setShowBankModal(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setShowBankModal(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={styles.profileModalContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.profileModalTitle}>계좌 정보</Text>

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
                    placeholder="123456-78-901234"
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
          </ScrollView>
        </View>
      </Modal>
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
    borderLeftWidth: 4,
    borderLeftColor: '#FF3D68',
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
    color: '#FF3D68',
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
    backgroundColor: '#E8F5FF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  paidBadgeText: {
    color: '#0084FF',
    fontWeight: '500',
    fontSize: 12,
  },
  pendingBadge: {
    backgroundColor: '#FFF4E5',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  pendingBadgeText: {
    color: '#E67700',
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
