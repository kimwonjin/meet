import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { EXTRA_CONDITIONS, JOB_CATEGORIES, MemberDetail } from '@/lib/memberDetails';
import { DISTRICTS } from '@/lib/regions';

export type FilterableMember = { id: string; name?: string; gender?: string; age?: number; location?: string };

const REGIONS = ['서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주'];

function toggleIn<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// 회원 목록 필터 (이름·성별·연령대·지역). 매칭 탭과 회원 탭에서 같이 쓴다.
// keepIds: 필터와 관계없이 항상 보여줄 회원 (예: 이미 고른 회원)
// details: 파트너 화면에서 회원들의 직업 분류·조건 (있으면 그 필터도 보여준다)
export function useMemberFilter(details?: Map<string, MemberDetail>, districts?: Map<string, string>) {
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<'all' | 'M' | 'F'>('all');
  const [ages, setAges] = useState<number[]>([]); // 20, 30, 40(=40대 이상)
  const [regions, setRegions] = useState<string[]>([]);
  const [jobCats, setJobCats] = useState<string[]>([]);
  // 서울·경기 안의 구·시 (고른 시·도 안에서만 적용)
  const [dists, setDists] = useState<string[]>([]);
  const [conds, setConds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const active = !!query.trim() || gender !== 'all' || ages.length > 0 || regions.length > 0 || jobCats.length > 0 || conds.length > 0 || dists.length > 0;
  const chipCount = (gender !== 'all' ? 1 : 0) + ages.length + regions.length + jobCats.length + conds.length + dists.length;

  // partnerName: 동맹 회원이면 소속 파트너 이름도 같이 찾는다 / note: 내가 쓴 메모 내용으로도 찾는다
  function passes(m: FilterableMember, keepIds: string[] = [], partnerName?: string, note?: string) {
    if (keepIds.includes(m.id)) return true;
    const q = query.trim();
    if (q && !(m.name || '').includes(q) && !(partnerName || '').includes(q) && !(note || '').includes(q)) return false;
    if (gender !== 'all' && m.gender !== gender) return false;
    if (ages.length) {
      if (!m.age) return false;
      if (!ages.includes(Math.min(40, Math.floor(m.age / 10) * 10))) return false;
    }
    if (regions.length && !regions.includes(m.location || '')) return false;
    // 그 시·도 안에서 구·시를 골랐으면 그 구·시만 (다른 시·도 회원은 그대로)
    const want = dists.filter((d) => (DISTRICTS[m.location || ''] || []).includes(d));
    if (want.length && !want.includes(districts?.get(m.id) || '')) return false;
    // 직업 분류는 고른 것 중 하나, 조건은 고른 것 중 하나라도 해당하면 통과
    const d = details?.get(m.id);
    if (jobCats.length && !(d?.jobCategory && jobCats.includes(d.jobCategory))) return false;
    if (conds.length && !(d?.conditions || []).some((c) => conds.includes(c))) return false;
    return true;
  }

  function reset() {
    setQuery('');
    setGender('all');
    setAges([]);
    setRegions([]);
    setDists([]);
    setJobCats([]);
    setConds([]);
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
  function render(candidates: FilterableMember[], withToggle = true, placeholder = '🔍 회원·파트너 이름으로 찾기') {
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
            placeholder={placeholder}
            placeholderTextColor="#A9A6AF"
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
                {regionOptions.map((r) => chip(r, regions.includes(r), () => {
                  const next = toggleIn(regions, r);
                  setRegions(next);
                  setDists(dists.filter((d) => next.some((x) => (DISTRICTS[x] || []).includes(d))));
                }))}
              </View>
            )}
            {/* 서울·경기를 골랐으면 그 안의 구·시 (회원이 있는 곳만) */}
            {regions.filter((r) => DISTRICTS[r]).map((r) => {
              const here = DISTRICTS[r].filter((d) => dists.includes(d) || candidates.some((m) => m.location === r && districts?.get(m.id) === d));
              if (!here.length) return null;
              return (
                <View key={r}>
                  <Text style={styles.label}>{r} 안에서</Text>
                  <View style={styles.row}>{here.map((d) => chip(d, dists.includes(d), () => setDists(toggleIn(dists, d))))}</View>
                </View>
              );
            })}
            {/* 회원이 직접 고른 직업 분류·조건 (고른 회원이 있을 때만) */}
            {(() => {
              const ds = candidates.map((m) => details?.get(m.id)).filter(Boolean) as MemberDetail[];
              const cats = JOB_CATEGORIES.filter((c) => jobCats.includes(c) || ds.some((d) => d.jobCategory === c));
              const cs = EXTRA_CONDITIONS.filter((c) => c !== '해당 없음' && (conds.includes(c) || ds.some((d) => d.conditions.includes(c))));
              return (
                <>
                  {cats.length > 0 && <Text style={styles.label}>직업 분류</Text>}
                  {cats.length > 0 && <View style={styles.row}>{cats.map((c) => chip(c, jobCats.includes(c), () => setJobCats(toggleIn(jobCats, c))))}</View>}
                  {cs.length > 0 && <Text style={styles.label}>해당 조건 (회원이 직접 고름)</Text>}
                  {cs.length > 0 && <View style={styles.row}>{cs.map((c) => chip(c, conds.includes(c), () => setConds(toggleIn(conds, c))))}</View>}
                </>
              );
            })()}
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
  toggle: { borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  toggleOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  toggleText: { fontSize: 14, color: '#65626B' },
  toggleTextOn: { color: '#5B21FF', fontWeight: '600' },
  search: { flex: 1, borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, color: '#8F8C95', marginTop: 4 },
  chip: { borderWidth: 1, borderColor: '#E1DEE7', borderRadius: 16, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  chipOn: { borderColor: '#5B21FF', backgroundColor: '#F1ECFF' },
  chipText: { fontSize: 13, color: '#65626B' },
  chipTextOn: { color: '#5B21FF', fontWeight: '600' },
  divider: { width: 1, height: 18, backgroundColor: '#E4E1EA', marginHorizontal: 2 },
  reset: { alignSelf: 'flex-start', paddingVertical: 4 },
  resetText: { fontSize: 12, color: '#98959E', textDecorationLine: 'underline' },
});
