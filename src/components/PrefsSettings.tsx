// 회원 '원하는 상대' (선호 조건): 마이 메뉴 줄 + 고르는 시트
// 칩을 누르기만 하면 되고, 고르지 않으면 '상관없어요'
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { AGE_OPTIONS, AgeKey, EMPTY_PREFS, getMyPrefs, HEIGHT_OPTIONS, PREF_REGIONS, Prefs, prefsSummary, saveMyPrefs } from '@/lib/preferences';

export function PrefsMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<{ available: boolean; prefs: Prefs } | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Prefs>(EMPTY_PREFS);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!user || user.role !== 'hopeful') return;
    let alive = true;
    getMyPrefs(user.id).then((r) => alive && setState(r)).catch(() => {});
    return () => { alive = false; };
  }, [user?.id, user?.role]));

  if (!state?.available) return null;
  const summary = prefsSummary(state.prefs);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} style={[s.chip, on && s.chipOn]} onPress={onPress} accessibilityLabel={`원하는 상대 ${label}`} accessibilityState={{ selected: on }}>
      <Text style={[s.chipT, on && s.chipTOn]}>{label}</Text>
    </TouchableOpacity>
  );

  async function save() {
    if (!user || saving) return;
    setSaving(true);
    const ok = await saveMyPrefs(user.id, draft);
    setSaving(false);
    if (!ok) { toast.show('저장하지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    setState({ available: true, prefs: draft });
    setOpen(false);
    toast.show('✓ 원하는 상대를 저장했어요', 'success');
  }

  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => { setDraft(state.prefs); setOpen(true); }} accessibilityLabel="원하는 상대">
        <Text style={m.menuIcon}>💝</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>원하는 상대</Text>
          <Text style={m.menuSub} numberOfLines={1}>{summary || '알려 주면 더 잘 맞는 분을 소개받아요'}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="원하는 상대"
        footer={
          <TouchableOpacity style={[s.btn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving} accessibilityLabel="원하는 상대 저장하기">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>저장하기</Text>}
          </TouchableOpacity>
        }
      >
        <View style={{ gap: 6, paddingBottom: 4 }}>
          <Text style={s.lead}>고르지 않은 항목은 '상관없어요'로 볼게요. 파트너에게만 보여요</Text>

          <Text style={s.label}>나이 <Text style={s.multi}>여러 개 고를 수 있어요</Text></Text>
          <View style={s.row}>{AGE_OPTIONS.map(([k, label]) => chip(label, draft.ages.includes(k), () => setDraft({ ...draft, ages: toggle<AgeKey>(draft.ages, k) })))}</View>

          <Text style={s.label}>사는 곳 <Text style={s.multi}>여러 개 고를 수 있어요</Text></Text>
          <View style={s.row}>{PREF_REGIONS.map((r) => chip(r, draft.regions.includes(r), () => setDraft({ ...draft, regions: toggle(draft.regions, r) })))}</View>

          <Text style={s.label}>키</Text>
          <View style={s.row}>
            {chip('상관없어요', draft.heightMin === null, () => setDraft({ ...draft, heightMin: null }))}
            {HEIGHT_OPTIONS.map((h) => chip(`${h}cm 이상`, draft.heightMin === h, () => setDraft({ ...draft, heightMin: h })))}
          </View>

          <Text style={s.label}>흡연</Text>
          <View style={s.row}>
            {chip('상관없어요', !draft.nonSmoker, () => setDraft({ ...draft, nonSmoker: false }))}
            {chip('비흡연이면 좋아요', draft.nonSmoker, () => setDraft({ ...draft, nonSmoker: true }))}
          </View>

          <Text style={s.note}>조건에 꼭 맞는 분만 소개되는 건 아니에요. 파트너가 참고해서 더 잘 맞는 분을 먼저 찾아 드려요</Text>
        </View>
      </BottomSheet>
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 13, color: '#65626B', lineHeight: 19, marginBottom: 4 },
  label: { fontSize: 14, fontWeight: '700', color: '#322F38', marginTop: 12 },
  multi: { fontSize: 11, fontWeight: '400', color: '#98959E' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 999, borderWidth: 1, borderColor: '#DCD9E2', justifyContent: 'center' },
  chipOn: { borderColor: '#5B21FF', backgroundColor: '#F5F1FF' },
  chipT: { fontSize: 13, color: '#65626B' },
  chipTOn: { color: '#5B21FF', fontWeight: '700' },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18, marginTop: 14 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
