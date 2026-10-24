// 회원 '잠시 쉬기': 마이 메뉴 줄(PauseMenuRow) · 안내 시트 · 홈 배너(PauseBanner)
// 쉬는 중이면 홈 맨 위에 알리고 바로 다시 시작할 수 있게 한다 (막힌 흐름을 만들지 않는다)
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { getPauseState, setPaused } from '@/lib/pause';

function usePause() {
  const { user } = useAuth();
  const [state, setState] = useState<{ available: boolean; pausedAt: string | null } | null>(null);
  useFocusEffect(useCallback(() => {
    if (!user || user.role !== 'hopeful') return;
    let alive = true;
    getPauseState(user.id).then((s) => alive && setState(s)).catch(() => {});
    return () => { alive = false; };
  }, [user?.id, user?.role]));
  return { state, setState };
}

function PauseSheet({ visible, onClose, paused, onChanged }: { visible: boolean; onClose: () => void; paused: boolean; onChanged: (at: string | null) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!user || busy) return;
    setBusy(true);
    const r = await setPaused(user, !paused);
    setBusy(false);
    if (!r.ok) { toast.show('바꾸지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    onChanged(r.at);
    toast.show(r.at ? '소개를 잠시 쉬어요. 언제든 다시 시작할 수 있어요' : '✓ 다시 소개받기를 시작했어요', r.at ? 'info' : 'success');
    onClose();
  }
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={paused ? '다시 소개받을까요?' : '소개 잠시 쉬기'}
      footer={
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.7 }]} onPress={toggle} disabled={busy} accessibilityLabel={paused ? '다시 소개받기' : '잠시 쉬기'}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>{paused ? '다시 소개받기' : '잠시 쉬기'}</Text>}
        </TouchableOpacity>
      }
    >
      <View style={{ gap: 10, paddingBottom: 4 }}>
        {(paused
          ? ['다시 시작하면 파트너가 새 소개를 제안할 수 있어요', '파트너에게도 다시 시작했다고 알려드려요']
          : ['쉬는 동안은 새 소개 제안을 받지 않아요', '이미 진행 중인 소개는 그대로 이어져요', '이용권은 그대로 남아 있어요', '언제든 홈이나 마이에서 다시 시작할 수 있어요']
        ).map((t) => (
          <View key={t} style={s.line}>
            <Text style={s.dot}>•</Text>
            <Text style={s.lineT}>{t}</Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

export function PauseMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { state, setState } = usePause();
  const [open, setOpen] = useState(false);
  if (!state?.available) return null;
  const paused = !!state.pausedAt;
  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => setOpen(true)} accessibilityLabel={paused ? '소개 쉬는 중' : '소개 잠시 쉬기'}>
        <Text style={m.menuIcon}>{paused ? '⏸' : '🌿'}</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>소개 잠시 쉬기</Text>
          <Text style={[m.menuSub, paused && { color: '#5B21FF' }]} numberOfLines={1}>{paused ? '쉬는 중' : '소개받는 중'}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>
      <PauseSheet visible={open} onClose={() => setOpen(false)} paused={paused} onChanged={(at) => setState({ available: true, pausedAt: at })} />
    </>
  );
}

export function PauseBanner() {
  const { state, setState } = usePause();
  const [open, setOpen] = useState(false);
  if (!state?.available || !state.pausedAt) return null;
  return (
    <>
      <View style={s.banner}>
        <Text style={s.bannerT}>⏸ 소개를 잠시 쉬고 있어요</Text>
        <TouchableOpacity style={s.bannerBtn} onPress={() => setOpen(true)} accessibilityLabel="다시 소개받기 열기">
          <Text style={s.bannerBtnT}>다시 시작</Text>
        </TouchableOpacity>
      </View>
      <PauseSheet visible={open} onClose={() => setOpen(false)} paused onChanged={(at) => setState({ available: true, pausedAt: at })} />
    </>
  );
}

const s = StyleSheet.create({
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  line: { flexDirection: 'row', gap: 8 },
  dot: { fontSize: 14, color: '#5B21FF' },
  lineT: { flex: 1, fontSize: 14, color: '#322F38', lineHeight: 21 },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F8F7FA' },
  bannerT: { fontSize: 13, color: '#322F38', fontWeight: '600' },
  bannerBtn: { borderWidth: 1, borderColor: '#5B21FF', borderRadius: 999, paddingHorizontal: 12, height: 30, justifyContent: 'center', backgroundColor: '#fff' },
  bannerBtnT: { fontSize: 12, color: '#5B21FF', fontWeight: '700' },
});
