// 파트너 '자리 비움': 마이 메뉴 줄(AwayMenuRow) · 기간 고르기 시트 · 홈 배너(AwayBanner) · 채팅 안내(AwayChatNotice)
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { addDays, awayLabel, getAway, setAway } from '@/lib/away';

const CHOICES: [number, string][] = [[2, '3일'], [6, '1주'], [13, '2주'], [29, '한 달']];

function useAway() {
  const { user } = useAuth();
  const [state, setState] = useState<{ available: boolean; until: string | null } | null>(null);
  useFocusEffect(useCallback(() => {
    if (!user || user.role !== 'connector') return;
    let alive = true;
    getAway(user.id).then((s) => alive && setState(s)).catch(() => {});
    return () => { alive = false; };
  }, [user?.id, user?.role]));
  return { state, setState };
}

function AwaySheet({ visible, onClose, until, onChanged }: { visible: boolean; onClose: () => void; until: string | null; onChanged: (u: string | null) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [pick, setPick] = useState(6);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setPick(6); }, [visible]);
  const next = until ? null : addDays(pick);

  async function save() {
    if (!user || busy) return;
    setBusy(true);
    const ok = await setAway(user.id, next);
    setBusy(false);
    if (!ok) { toast.show('바꾸지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    onChanged(next);
    toast.show(next ? `${awayLabel(next)}까지 자리 비움으로 알려요` : '✓ 자리 비움을 끝냈어요', next ? 'info' : 'success');
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={until ? '자리 비움을 끝낼까요?' : '자리 비움'}
      footer={
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.7 }]} onPress={save} disabled={busy} accessibilityLabel={until ? '자리 비움 끝내기' : '자리 비움 시작'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>{until ? '지금 끝내기' : `${awayLabel(next!)}까지 비우기`}</Text>}
        </TouchableOpacity>
      }
    >
      <View style={{ gap: 12, paddingBottom: 4 }}>
        {until ? (
          <Text style={s.lead}>{awayLabel(until)}까지 자리 비움 중이에요. 끝내면 회원 채팅의 안내가 바로 사라져요</Text>
        ) : (
          <>
            <Text style={s.lead}>오늘부터 얼마나 비우나요?</Text>
            <View style={s.chips}>
              {CHOICES.map(([d, label]) => (
                <TouchableOpacity key={d} style={[s.chip, pick === d && s.chipOn]} onPress={() => setPick(d)} accessibilityLabel={`자리 비움 ${label}`}>
                  <Text style={[s.chipT, pick === d && s.chipTOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {['회원과 대화할 때 "답이 늦을 수 있어요"라고 보여요', '쉬는 동안은 새 소개 독려 알림을 보내지 않아요', '진행 중인 소개와 알림은 그대로예요', '정한 날이 지나면 저절로 끝나요'].map((t) => (
              <View key={t} style={s.line}><Text style={s.dot}>•</Text><Text style={s.lineT}>{t}</Text></View>
            ))}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

export function AwayMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { state, setState } = useAway();
  const [open, setOpen] = useState(false);
  if (!state?.available) return null;
  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => setOpen(true)} accessibilityLabel="자리 비움">
        <Text style={m.menuIcon}>🏖</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>자리 비움</Text>
          <Text style={[m.menuSub, state.until && { color: '#5B21FF' }]}>{state.until ? `${awayLabel(state.until)}까지 비우는 중` : '휴가 때 회원에게 답이 늦다고 알려요'}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>
      <AwaySheet visible={open} onClose={() => setOpen(false)} until={state.until} onChanged={(u) => setState({ available: true, until: u })} />
    </>
  );
}

export function AwayBanner() {
  const { state, setState } = useAway();
  const [open, setOpen] = useState(false);
  if (!state?.available || !state.until) return null;
  return (
    <>
      <View style={s.banner}>
        <Text style={s.bannerT}>🏖 {awayLabel(state.until)}까지 자리 비움 중</Text>
        <TouchableOpacity style={s.bannerBtn} onPress={() => setOpen(true)} accessibilityLabel="자리 비움 끝내기 열기">
          <Text style={s.bannerBtnT}>끝내기</Text>
        </TouchableOpacity>
      </View>
      <AwaySheet visible={open} onClose={() => setOpen(false)} until={state.until} onChanged={(u) => setState({ available: true, until: u })} />
    </>
  );
}

// 채팅방 위: 상대 파트너가 자리 비움 중이면 한 줄로 알린다
export function AwayChatNotice({ partnerId, name }: { partnerId: string; name: string }) {
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUntil(null);
    getAway(partnerId).then((r) => alive && setUntil(r.until)).catch(() => {});
    return () => { alive = false; };
  }, [partnerId]);
  if (!until) return null;
  return (
    <View style={s.notice} accessibilityLabel="파트너 자리 비움 안내">
      <Text style={s.noticeT}>🏖 {name}님은 {awayLabel(until)}까지 자리를 비워요. 답이 늦을 수 있어요</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lead: { fontSize: 14, color: '#434049', lineHeight: 21 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#DCD9E2', alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  chipT: { fontSize: 14, color: '#54515A', fontWeight: '600' },
  chipTOn: { color: '#5B21FF' },
  line: { flexDirection: 'row', gap: 8 },
  dot: { fontSize: 14, color: '#5B21FF' },
  lineT: { flex: 1, fontSize: 13, color: '#54515A', lineHeight: 20 },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F8F7FA' },
  bannerT: { fontSize: 13, color: '#322F38', fontWeight: '600' },
  bannerBtn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 999, paddingHorizontal: 12, height: 30, justifyContent: 'center', backgroundColor: '#fff' },
  bannerBtnT: { fontSize: 12, color: '#5B21FF', fontWeight: '700' },
  notice: { backgroundColor: '#F8F7FA', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ECEAF1' },
  noticeT: { fontSize: 13, color: '#54515A', lineHeight: 19 },
});
