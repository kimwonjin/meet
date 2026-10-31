import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { blockUser, leavePartner, REPORT_REASONS, reportUser, ReportContext } from '@/lib/safety';
import { supabase } from '@/lib/supabase';

interface Props {
  targetId: string;
  targetName: string;
  context: ReportContext;
  // 'links': 프로필 아래 작은 글씨 링크 / 'menu': 채팅 헤더의 ⋯ 버튼 / 'none': 버튼 없이 openReport로만 연다
  variant?: 'links' | 'menu' | 'none';
  // true가 되면 신고 시트를 바로 연다 (예: 만남 다음 날 '불편한 일이 있었어요')
  openReport?: boolean;
  // 신고 시트를 닫거나 신고를 마쳤을 때
  onClose?: () => void;
  // 차단을 마친 뒤 (예: 채팅 입력창 잠그기)
  onBlocked?: () => void;
}

// 프로필·채팅 아래에 두는 작은 '신고하기 · 차단하기' 링크.
// 자주 쓰는 기능이 아니므로 눈에 띄지 않게 회색 글씨로 두고, 누르면 바텀시트가 열린다.
export default function SafetyActions({ targetId, targetName, context, variant = 'links', onBlocked, openReport, onClose }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'menu' | 'report' | 'block' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  // 회원이 자기 담당 파트너를 차단하는 경우: 가입도 함께 해지할지 묻는다 (기본: 해지)
  const [isMyPartner, setIsMyPartner] = useState(false);
  const [alsoLeave, setAlsoLeave] = useState(true);
  useEffect(() => {
    if (mode !== 'block' || !user || user.role !== 'hopeful') return;
    supabase.from('hopeful_requests').select('id').eq('hopeful_id', user.id).eq('connector_id', targetId).in('status', ['approved', 'pending'])
      .then(({ data }) => { setIsMyPartner(!!data?.length); setAlsoLeave(true); });
  }, [mode, targetId, user?.id]);
  useEffect(() => { if (openReport) setMode('report'); }, [openReport]);

  if (!user || user.id === targetId) return null;

  function close() {
    if (busy) return;
    setMode(null);
    setReason(null);
    setDetail('');
    onClose?.();
  }

  async function submitReport() {
    if (!user || !reason || busy) return;
    setBusy(true);
    const ok = await reportUser(user.id, targetId, context, reason, detail);
    setBusy(false);
    if (!ok) {
      toast.show('신고를 접수하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
      return;
    }
    toast.show('신고가 접수됐어요. 운영자가 확인 후 조치할게요', 'success');
    setMode(null);
    setReason(null);
    setDetail('');
    onClose?.();
  }

  async function submitBlock() {
    if (!user || busy) return;
    setBusy(true);
    const ok = await blockUser(user.id, targetId);
    setBusy(false);
    if (!ok) {
      toast.show('차단하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
      return;
    }
    if (isMyPartner && alsoLeave) {
      const left = await leavePartner(user.id, targetId);
      toast.show(left ? `${targetName}님을 차단하고 가입을 해지했어요. 남은 이용권은 마이 › 이용권/결제에서 환불받을 수 있어요` : `${targetName}님을 차단했어요. 진행 중인 소개가 있어 가입 해지는 소개가 끝난 뒤에 할 수 있어요`, 'success');
    } else {
      toast.show(`${targetName}님을 차단했어요`, 'success');
    }
    setMode(null);
    onBlocked?.();
  }

  const blockEffect =
    context === 'match'
      ? '다시 매칭되지 않아요. 진행 중인 소개는 거절하거나 "일정 변경·취소 요청"으로 취소해주세요.'
      : '서로 메시지를 보낼 수 없어요.';

  return (
    <>
      {variant === 'none' ? null : variant === 'menu' ? (
        <TouchableOpacity onPress={() => setMode('menu')} style={styles.menuBtn} accessibilityLabel="신고·차단 메뉴">
          <Text style={styles.menuBtnText}>⋯</Text>
        </TouchableOpacity>
      ) : (
      <View style={styles.links}>
        <TouchableOpacity onPress={() => setMode('report')} style={styles.link} accessibilityLabel={`${targetName} 신고하기`}>
          <Text style={styles.linkText}>신고하기</Text>
        </TouchableOpacity>
        <Text style={styles.dot}>·</Text>
        <TouchableOpacity onPress={() => setMode('block')} style={styles.link} accessibilityLabel={`${targetName} 차단하기`}>
          <Text style={styles.linkText}>차단하기</Text>
        </TouchableOpacity>
      </View>
      )}

      <BottomSheet visible={mode === 'menu'} onClose={close} title={targetName}>
        <TouchableOpacity style={styles.menuRow} onPress={() => setMode('report')}>
          <Text style={styles.menuRowText}>신고하기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => setMode('block')}>
          <Text style={styles.menuRowText}>차단하기</Text>
        </TouchableOpacity>
      </BottomSheet>

      <BottomSheet visible={mode === 'report'} onClose={close} title={`${targetName}님 신고`}>
        <Text style={styles.desc}>어떤 문제가 있었나요? 신고한 사실은 상대에게 알리지 않아요.</Text>
        <View style={styles.reasons}>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r} style={[styles.reason, reason === r && styles.reasonOn]} onPress={() => setReason(r)}>
              <Text style={[styles.reasonText, reason === r && styles.reasonTextOn]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder="자세한 내용 (선택)"
          placeholderTextColor="#A9A6AF"
          value={detail}
          onChangeText={setDetail}
          multiline
          maxLength={500}
        />
        <TouchableOpacity style={[styles.primary, (!reason || busy) && styles.disabled]} onPress={submitReport} disabled={!reason || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>신고하기</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <BottomSheet visible={mode === 'block'} onClose={close} title={`${targetName}님 차단`}>
        <Text style={styles.desc}>차단하면 {targetName}님과 {blockEffect}</Text>
        <Text style={styles.sub}>상대에게는 차단 사실을 알리지 않아요. 마이 › 차단 목록에서 언제든 풀 수 있어요.</Text>
        {isMyPartner && (
          <TouchableOpacity style={styles.leaveRow} onPress={() => setAlsoLeave(!alsoLeave)} accessibilityRole="checkbox" accessibilityState={{ checked: alsoLeave }} accessibilityLabel="이 파트너와의 가입도 해지">
            <View style={[styles.leaveCheck, alsoLeave && styles.leaveCheckOn]}>{alsoLeave && <Text style={styles.leaveMark}>✓</Text>}</View>
            <Text style={styles.leaveText}>이 파트너와의 가입도 해지할게요{'\n'}<Text style={styles.leaveSub}>새 소개를 받지 않아요. 진행 중인 소개가 있으면 끝난 뒤에 해지할 수 있어요</Text></Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={submitBlock} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>차단하기</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, gap: 4 },
  link: { paddingHorizontal: 10, paddingVertical: 8 },
  linkText: { fontSize: 13, color: '#736F7A', textDecorationLine: 'underline' },
  dot: { color: '#CBC8D1' },
  menuBtn: { width: 30, alignItems: 'flex-end' },
  menuBtnText: { fontSize: 22, color: '#65626B' },
  menuRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1EFF4' },
  menuRowText: { fontSize: 15, color: '#322F38' },
  desc: { fontSize: 14, color: '#322F38', lineHeight: 21, marginBottom: 12 },
  sub: { fontSize: 13, color: '#6E6A75', lineHeight: 19, marginBottom: 16 },
  leaveRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F8F6FB', borderRadius: 10, padding: 12, marginBottom: 16 },
  leaveCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#CBC8D1', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  leaveCheckOn: { backgroundColor: '#5B21FF', borderColor: '#5B21FF' },
  leaveMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  leaveText: { flex: 1, fontSize: 14, color: '#322F38', lineHeight: 20 },
  leaveSub: { fontSize: 12, color: '#6E6A75' },
  reasons: { gap: 8, marginBottom: 12 },
  reason: { borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  reasonOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  reasonText: { fontSize: 14, color: '#434049' },
  reasonTextOn: { color: '#5B21FF', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, padding: 12, minHeight: 80, fontSize: 14, textAlignVertical: 'top', marginBottom: 16 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
