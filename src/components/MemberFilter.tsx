import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export type FilterableMember = { id: string; name?: string; gender?: string; age?: number; location?: string };

const REGIONS = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주'];

function toggleIn<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// 회원 목록 필터 (이름·성별·연령대·지역). 매칭 탭과 회원 탭에서 같이 쓴다.
// keepIds: 필터와 관계없이 항상 보여줄 회원 (예: 이미 고른 회원)
export function useMemberFilter() {
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<'all' | 'M' | 'F'>('all');
  const [ages, setAges] = useState<number[]>([]); // 20, 30, 40(=40대 이상)
  const [regions, setRegions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const active = !!query.trim() || gender !== 'all' || ages.length > 0 || regions.length > 0;
  const chipCount = (gender !== 'all' ? 1 : 0) + ages.length + regions.length;

  function passes(m: FilterableMember, keepIds: string[] = []) {
    if (keepIds.includes(m.id)) return true;
    if (query.trim() && !(m.name || '').includes(query.trim())) return false;
    if (gender !== 'all' && m.gender !== gender) return false;
    if (ages.length) {
      if (!m.age) return false;
      if (!ages.includes(Math.min(40, Math.floor(m.age / 10) * 10))) return false;
    }
    if (regions.length && !regions.includes(m.location || '')) return false;
    return true;
  }

  function reset() {
    setQuery('');
    setGender('all');
    setAges([]);
    setRegions([]);
  }

  // '필터' 버튼만 따로 (다른 줄에 놓고 싶을 때)
  function renderToggle() {
    return (
      <TouchableOpacity
        style={[styles.toggle, (open || chipCount > 0) && styles.toggleOn]}
        onPress={() => setOpen(!open)}
        accessibilityLabel={open ? '필터 접기' : '필터 펼치기'}
      >
        <Text style={[styles.toggleText, (open || chipCount > 0) && styles.toggleTextOn]}>
          필터{chipCount > 0 ? ` ${chipCount}` : ''} {open ? '▴' : '▾'}
        </Text>
      </TouchableOpacity>
    );
  }

  // candidates: 지역 버튼을 만들 기준 회원들 (있는 지역만 보여준다)
  // withToggle=false: 필터 버튼은 renderToggle()로 다른 곳에 따로 놓는다
  function render(candidates: FilterableMember[], withToggle = true) {
    // 동맹 관리 필터와 같은 모양: 고정된 8개 지역 + 회원 지역 중 목록에 없는 값
    const extra = [...new Set(candidates.map((m) => m.location).filter((l) => l && !REGIONS.includes(l)) as string[])].sort();
    const regionOptions = [...REGIONS, ...extra];
    const chip = (label: string, on: boolean, onPress: () => void) => (
      <TouchableOpacity key={label} style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityLabel={`필터 ${label}`} accessibilityState={{ selected: on }}>
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
      </TouchableOpacity>
    );
    return (
      <View style={styles.box}>
        {/* 검색창 옆 '필터' 버튼 하나로 접어 두고, 누르면 조건이 펼쳐진다 */}
        <View style={styles.topRow}>
          <TextInput
            style={styles.search}
            placeholder="🔍 이름으로 찾기"
            placeholderTextColor="#aaa"
            value={query}
            onChangeText={setQuery}
          />
          {withToggle && renderToggle()}
        </View>
        {open && (
          <>
            <Text style={styles.label}>성별 · 연령대</Text>
            <View style={styles.row}>
              {chip('전체', gender === 'all', () => setGender('all'))}
              {chip('남성', gender === 'M', () => setGender('M'))}
              {chip('여성', gender === 'F', () => setGender('F'))}
              <View style={styles.divider} />
              {[20, 30, 40].map((d) => chip(d === 40 ? '40대+' : `${d}대`, ages.includes(d), () => setAges(toggleIn(ages, d))))}
            </View>
            {regionOptions.length > 0 && <Text style={styles.label}>지역</Text>}
            {regionOptions.length > 0 && (
              <View style={styles.row}>
                {regionOptions.map((r) => chip(r, regions.includes(r), () => setRegions(toggleIn(regions, r))))}
              </View>
            )}
          </>
        )}
        {active && (
          <TouchableOpacity onPress={reset} style={styles.reset}>
            <Text style={styles.resetText}>필터 초기화</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return { active, passes, render, renderToggle, reset };
}

const styles = StyleSheet.create({
  box: { gap: 8, marginBottom: 4 },
  topRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  toggle: { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  toggleOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  toggleText: { fontSize: 14, color: '#666' },
  toggleTextOn: { color: '#5B21FF', fontWeight: '600' },
  search: { flex: 1, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, color: '#8E8E93', marginTop: 4 },
  chip: { borderWidth: 1, borderColor: '#E0E0E6', borderRadius: 16, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  chipOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  chipText: { fontSize: 13, color: '#666' },
  chipTextOn: { color: '#5B21FF', fontWeight: '600' },
  divider: { width: 1, height: 18, backgroundColor: '#e5e5e5', marginHorizontal: 2 },
  reset: { alignSelf: 'flex-start', paddingVertical: 4 },
  resetText: { fontSize: 12, color: '#999', textDecorationLine: 'underline' },
});
