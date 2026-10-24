// 휴대폰 알림: 홈 안내 카드(PushPrompt) · 마이 메뉴 줄(PushMenuRow) · 상태별 안내 시트(PushSheet)
// 서버 준비 전(SQL 실행 전)이거나 지원하지 않는 환경이면 아무것도 보이지 않는다
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { createNotification } from '@/lib/notifications';
import { onAppVisible } from '@/lib/visibility';
import { disablePush, enablePush, getPushState, isIOS, isKakao, openInExternalBrowser, PushState } from '@/lib/push';

const HIDDEN = new Set<PushState>(['unavailable', 'unsupported']);
const DISMISS_KEY = 'push_prompt_dismissed_at';
const DISMISS_DAYS = 7;

export function usePushState() {
  const [state, setState] = useState<PushState>('unavailable');
  const refresh = useCallback(() => { getPushState().then(setState).catch(() => setState('unavailable')); }, []);
  useEffect(() => {
    refresh();
    return onAppVisible(refresh); // 설정 앱에서 권한을 바꾸고 돌아온 경우
  }, [refresh]);
  return { state, refresh, setState };
}

// 마이 메뉴 줄 오른쪽에 짧게
const SHORT_STATUS: Record<PushState, string> = { on: '켜짐', off: '꺼짐', 'needs-install': '홈 화면 추가 필요', inapp: '다른 브라우저에서', denied: '차단됨', unsupported: '', unavailable: '' };
const STATUS: Record<PushState, string> = {
  on: '켜져 있어요',
  off: '꺼져 있어요',
  'needs-install': '홈 화면에 추가하면 켤 수 있어요',
  inapp: '다른 브라우저에서 켤 수 있어요',
  denied: '차단되어 있어요',
  unsupported: '',
  unavailable: '',
};

export function PushSheet({ visible, onClose, state, onChanged }: { visible: boolean; onClose: () => void; state: PushState; onChanged: (s: PushState) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const examples = user?.role === 'connector'
    ? '가입 신청 · 동맹 요청 · 매칭 동의 요청 · 새 메시지'
    : user?.role === 'operator' ? '파트너 신청 · 출금·환불 요청 · 신고 · 새 메시지' : '매칭 제안 · 만남 일정 · 새 메시지';

  async function turnOn() {
    if (!user || busy) return;
    setBusy('on');
    const r = await enablePush(user.id);
    setBusy(null);
    if (r === 'on') { toast.show('✓ 알림을 켰어요', 'success'); onChanged('on'); }
    else if (r === 'denied') onChanged('denied');
    else toast.show('알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
  }
  async function turnOff() {
    if (busy) return;
    setBusy('off');
    await disablePush().catch(() => {});
    setBusy(null);
    toast.show('이 기기에서 알림을 껐어요', 'info');
    onChanged('off');
  }
  async function sendTest() {
    if (!user || busy) return;
    setBusy('test');
    await createNotification({ userId: user.id, type: 'push_test', title: '알림이 잘 와요 🎉', body: '앞으로 중요한 소식을 이렇게 알려드릴게요', route: '/home' });
    setBusy(null);
    toast.show('몇 초 안에 휴대폰 알림이 와요', 'info');
  }

  const steps = (items: string[]) => (
    <View style={s.steps}>
      {items.map((t, i) => (
        <View key={t} style={s.step}>
          <Text style={s.stepN}>{i + 1}</Text>
          <Text style={s.stepT}>{t}</Text>
        </View>
      ))}
    </View>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  const primary = (label: string, onPress: () => void, loading = false) => (
    <TouchableOpacity style={[s.btn, loading && { opacity: 0.7 }]} onPress={onPress} disabled={loading} accessibilityLabel={label}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>{label}</Text>}
    </TouchableOpacity>
  );

  if (state === 'off') {
    body = (
      <>
        <Text style={s.lead}>앱을 닫아 둬도 중요한 소식을 휴대폰으로 바로 알려드려요</Text>
        <View style={s.box}><Text style={s.boxT}>{examples}</Text></View>
        <Text style={s.note}>버튼을 누른 뒤 나오는 창에서 '허용'을 눌러 주세요</Text>
      </>
    );
    footer = primary('알림 켜기', turnOn, busy === 'on');
  } else if (state === 'on') {
    body = (
      <>
        <Text style={s.lead}>✓ 이 기기에서 알림을 받고 있어요</Text>
        <View style={s.box}><Text style={s.boxT}>{examples}</Text></View>
        <View style={s.links}>
          <TouchableOpacity onPress={sendTest} disabled={!!busy} accessibilityLabel="테스트 알림 보내기">
            <Text style={s.link}>{busy === 'test' ? '보내는 중…' : '테스트 알림 보내기'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={turnOff} disabled={!!busy} accessibilityLabel="이 기기에서 알림 끄기">
            <Text style={s.linkMuted}>{busy === 'off' ? '끄는 중…' : '이 기기에서 알림 끄기'}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
    footer = primary('확인', onClose);
  } else if (state === 'needs-install') {
    body = (
      <>
        <Text style={s.lead}>아이폰은 홈 화면에 추가한 앱에서 알림을 받을 수 있어요</Text>
        {steps([
          '사파리 아래쪽 공유 버튼(네모에 위 화살표)을 눌러요',
          "'홈 화면에 추가'를 눌러요",
          '홈 화면에 생긴 두두인연 아이콘으로 열고 한 번 더 로그인해요',
          '마이 › 휴대폰 알림에서 알림을 켜요',
        ])}
        <Text style={s.note}>iOS 16.4 이상에서 쓸 수 있어요</Text>
      </>
    );
    footer = primary('확인', onClose);
  } else if (state === 'inapp') {
    const kakao = isKakao();
    body = (
      <>
        <Text style={s.lead}>{kakao ? '카카오톡' : '지금 앱'} 안에서는 휴대폰 알림을 받을 수 없어요</Text>
        <Text style={s.note}>{isIOS() ? '사파리' : '크롬'}에서 두두인연을 열면 알림을 켤 수 있어요</Text>
      </>
    );
    footer = kakao
      ? primary('다른 브라우저로 열기', () => openInExternalBrowser())
      : primary('주소 복사하기', async () => {
          await Clipboard.setStringAsync(typeof window !== 'undefined' ? window.location.origin : '');
          toast.show(`주소를 복사했어요. ${isIOS() ? '사파리' : '크롬'} 주소창에 붙여 넣어 주세요`, 'success');
        });
  } else if (state === 'denied') {
    body = (
      <>
        <Text style={s.lead}>이 기기에서 알림이 차단되어 있어요</Text>
        {steps(isIOS()
          ? ['아이폰 설정 앱을 열어요', "'알림' › '두두인연'을 눌러요", "'알림 허용'을 켜고 돌아와요"]
          : ['주소창 왼쪽 자물쇠(또는 설정) 아이콘을 눌러요', "'권한' › '알림'을 눌러요", "'허용'으로 바꾸고 돌아와요"])}
      </>
    );
    footer = primary('확인', onClose);
  }

  return (
    <BottomSheet visible={visible && !!body} onClose={onClose} title="휴대폰 알림" footer={footer}>
      <View style={{ gap: 12, paddingBottom: 4 }}>{body}</View>
    </BottomSheet>
  );
}

// 홈 안내 카드: 아직 알림을 켜지 않은 사람에게만. '나중에'를 누르면 7일 동안 숨긴다
export function PushPrompt() {
  const { user } = useAuth();
  const { state, setState } = usePushState();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => setDismissed(!!v && Date.now() - Number(v) < DISMISS_DAYS * 86400000))
      .catch(() => setDismissed(false));
  }, []);

  if (dismissed || !['off', 'needs-install', 'inapp'].includes(state)) return null;

  async function onPress() {
    // 바로 켤 수 있으면 권한 창부터 (아이폰은 버튼을 누른 직후여야 창이 뜬다)
    if (state === 'off' && user) {
      setBusy(true);
      const r = await enablePush(user.id);
      setBusy(false);
      if (r === 'on' || r === 'denied') { setState(r); if (r === 'denied') setOpen(true); return; }
    }
    setOpen(true);
  }

  return (
    <>
      <View style={s.card}>
        <Text style={s.cardIcon}>🔔</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>휴대폰 알림 받기</Text>
          <Text style={s.cardSub}>앱을 닫아 둬도 새 소식을 바로 알려드려요</Text>
        </View>
        <TouchableOpacity style={s.cardBtn} onPress={onPress} disabled={busy} accessibilityLabel="휴대폰 알림 켜기">
          {busy ? <ActivityIndicator size="small" color="#5B21FF" /> : <Text style={s.cardBtnT}>켜기</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setDismissed(true); AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {}); }}
          hitSlop={10}
          accessibilityLabel="알림 안내 닫기"
        >
          <Text style={s.cardX}>✕</Text>
        </TouchableOpacity>
      </View>
      <PushSheet visible={open} onClose={() => setOpen(false)} state={state} onChanged={(n) => { setState(n); if (n === 'on') setOpen(false); }} />
    </>
  );
}

// 마이 메뉴 줄 (메뉴 모양은 마이 화면 스타일을 받아 쓴다)
export function PushMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { state, setState } = usePushState();
  const [open, setOpen] = useState(false);
  if (HIDDEN.has(state)) return null;
  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => setOpen(true)} accessibilityLabel={`휴대폰 알림 ${STATUS[state]}`}>
        <Text style={m.menuIcon}>🔔</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>휴대폰 알림</Text>
          <Text style={[m.menuSub, state === 'on' && { color: '#5B21FF' }]} numberOfLines={1}>{SHORT_STATUS[state]}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>
      <PushSheet visible={open} onClose={() => setOpen(false)} state={state} onChanged={setState} />
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 15, fontWeight: '700', color: '#322F38', lineHeight: 22 },
  note: { fontSize: 12, color: '#87848D', lineHeight: 18 },
  box: { backgroundColor: '#F8F7FA', borderRadius: 10, padding: 12 },
  boxT: { fontSize: 13, color: '#5E5B64', lineHeight: 19 },
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepN: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#EDE4FF', color: '#5B21FF', fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  stepT: { flex: 1, fontSize: 14, color: '#322F38', lineHeight: 22 },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  link: { fontSize: 13, color: '#5B21FF', fontWeight: '700', paddingVertical: 6 },
  linkMuted: { fontSize: 13, color: '#98959E', paddingVertical: 6 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#F5F1FF', borderWidth: 1, borderColor: '#E4D9FF' },
  cardIcon: { fontSize: 22 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  cardSub: { fontSize: 12, color: '#87848D', marginTop: 2 },
  cardBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#5B21FF', borderRadius: 999, paddingHorizontal: 14, height: 32, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  cardBtnT: { color: '#5B21FF', fontSize: 13, fontWeight: '700' },
  cardX: { fontSize: 14, color: '#B5B2BB', paddingLeft: 2 },
});
