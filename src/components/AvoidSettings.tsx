// '아는 사람 피하기': 마이 메뉴 줄 + 설정 시트 (회원)
// - 같은 회사 사람은 소개받지 않기 (프로필에 회사를 넣어야 켤 수 있음)
// - 피할 사람 전화번호 등록 (안드로이드 크롬은 연락처에서 고르기 지원)
// 상대는 내가 피하기에 넣었는지 알 수 없다
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { addAvoidContact, AvoidState, getAvoidState, removeAvoidContact, setAvoidCompany } from '@/lib/avoid';

const canPickContacts = () => typeof navigator !== 'undefined' && 'contacts' in navigator && 'select' in (navigator as any).contacts;
const fmt = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.length <= 3 ? d : d.length <= 7 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};

export function AvoidMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = useState<AvoidState | null>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user || user.role !== 'hopeful') return;
    getAvoidState(user.id).then(setState).catch(() => {});
  }, [user?.id, user?.role]);
  useFocusEffect(load);

  if (!state?.available || !user) return null;
  const count = state.contacts.length;
  const sub = [state.avoidCompany && '같은 회사', count > 0 && `번호 ${count}개`].filter(Boolean).join(' · ');

  async function add(raw: string, quiet = false) {
    if (!user) return false;
    const r = await addAvoidContact(user.id, user.phone, raw);
    if (!quiet) {
      if (r === 'invalid') toast.show('휴대폰 번호를 확인해 주세요', 'error');
      else if (r === 'self') toast.show('내 번호는 넣을 수 없어요', 'info');
      else if (r === 'dup') toast.show('이미 넣은 번호예요', 'info');
      else if (r === 'error') toast.show('저장하지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    }
    return r === 'ok';
  }

  async function onAdd() {
    if (busy) return;
    setBusy(true);
    if (await add(phone)) { setPhone(''); toast.show('✓ 이 번호의 사람과는 소개되지 않아요', 'success'); }
    setBusy(false);
    load();
  }

  async function onPick() {
    try {
      const picked: any[] = await (navigator as any).contacts.select(['tel'], { multiple: true });
      let n = 0;
      for (const c of picked || []) for (const t of c.tel || []) if (await add(t, true)) n++;
      toast.show(n ? `✓ ${n}개 번호를 넣었어요` : '새로 넣은 번호가 없어요', n ? 'success' : 'info');
      load();
    } catch {
      // 사용자가 취소
    }
  }

  async function toggleCompany(on: boolean) {
    if (!user) return;
    if (on && !state?.company) {
      // 화면의 정보가 오래됐을 수 있어 한 번 더 확인한다
      const fresh = await getAvoidState(user.id);
      setState(fresh);
      if (!fresh.company) { toast.show('먼저 프로필에 회사를 넣어 주세요', 'info'); return; }
    }
    const ok = await setAvoidCompany(user.id, on);
    if (!ok) { toast.show('바꾸지 못했어요', 'error'); return; }
    setState((s) => (s ? { ...s, avoidCompany: on } : s));
  }

  return (
    <>
      {/* 열 때마다 최신 정보로 (방금 프로필에 회사를 넣은 경우 등) */}
      <TouchableOpacity style={m.menuItem} onPress={() => { load(); setOpen(true); }} accessibilityLabel="아는 사람 피하기">
        <Text style={m.menuIcon}>🛡️</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>아는 사람 피하기</Text>
          <Text style={[m.menuSub, !!sub && { color: '#5B21FF' }]} numberOfLines={1}>{sub ? `켜짐 · ${sub}` : ''}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="아는 사람 피하기">
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Text style={s.lead}>여기 넣은 사람과는 서로 소개되지 않아요. 상대는 내가 피하기에 넣었는지 알 수 없어요</Text>

          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>같은 회사 사람은 소개받지 않기</Text>
              <Text style={s.sub}>{state.company ? `내 회사: ${state.company}` : '프로필에 회사를 넣으면 켤 수 있어요'}</Text>
            </View>
            <Switch value={state.avoidCompany} onValueChange={toggleCompany} trackColor={{ true: '#5B21FF', false: '#DCD9E2' }} thumbColor="#fff" {...({ activeThumbColor: '#fff' } as any)} accessibilityLabel="같은 회사 사람은 소개받지 않기" />
          </View>
          {!state.company && (
            <TouchableOpacity onPress={() => { setOpen(false); router.push({ pathname: '/profile', params: { open: 'profile' } }); }} accessibilityLabel="프로필에 회사 넣기">
              <Text style={s.link}>프로필에 회사 넣기 ›</Text>
            </TouchableOpacity>
          )}

          <View style={s.divider} />
          <Text style={s.title}>피하고 싶은 사람 전화번호</Text>
          <View style={s.addRow}>
            <TextInput style={s.input} value={phone} onChangeText={(t) => setPhone(fmt(t))} placeholder="010-0000-0000" placeholderTextColor="#BAB7C0" keyboardType="phone-pad" accessibilityLabel="피할 전화번호" />
            <TouchableOpacity style={[s.addBtn, (busy || phone.replace(/\D/g, '').length < 10) && { opacity: 0.5 }]} onPress={onAdd} disabled={busy} accessibilityLabel="번호 넣기">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.addBtnT}>넣기</Text>}
            </TouchableOpacity>
          </View>
          {canPickContacts() && (
            <TouchableOpacity style={s.pick} onPress={onPick} accessibilityLabel="연락처에서 고르기">
              <Text style={s.pickT}>📇 연락처에서 고르기</Text>
            </TouchableOpacity>
          )}
          {state.contacts.length > 0 && (
            <View style={s.list}>
              {state.contacts.map((c) => (
                <View key={c.phone_hash} style={s.item}>
                  <Text style={s.itemT}>{c.label || '저장된 번호'}</Text>
                  <TouchableOpacity onPress={async () => { if (await removeAvoidContact(user.id, c.phone_hash)) load(); }} accessibilityLabel={`${c.label} 빼기`} hitSlop={8}>
                    <Text style={s.remove}>빼기</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <Text style={s.note}>번호는 알아볼 수 없는 값으로 바꿔 저장하고, 화면에는 뒷자리만 보여요. 아직 가입하지 않은 사람도 나중에 가입하면 적용돼요</Text>
        </View>
      </BottomSheet>
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 13, color: '#65626B', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  sub: { fontSize: 12, color: '#87848D', marginTop: 2 },
  link: { fontSize: 13, color: '#5B21FF', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F1EFF4' },
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, paddingHorizontal: 12, height: 46, fontSize: 15, color: '#322F38' },
  addBtn: { backgroundColor: '#5B21FF', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addBtnT: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pick: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, height: 42, alignItems: 'center', justifyContent: 'center' },
  pickT: { fontSize: 13, color: '#322F38', fontWeight: '600' },
  list: { backgroundColor: '#F8F7FA', borderRadius: 12, paddingHorizontal: 12 },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EFEDF2' },
  itemT: { fontSize: 14, color: '#322F38' },
  remove: { fontSize: 13, color: '#98959E' },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18 },
});
