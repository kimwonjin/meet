import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ProtectedPhoto from './ProtectedPhoto';
import { shownPhotos } from '@/lib/photos';

export type MemberProfile = {
  name?: string;
  gender?: string;
  age?: number;
  birth_date?: string;
  height?: number;
  location?: string;
  job?: string;
  education?: string;
  bio?: string;
  religion?: string;
  smoking?: string;
  drinking?: string;
  body_type?: string;
  photo_urls?: string[];
};

interface Props {
  member: MemberProfile;
  // 파트너가 볼 때만 생년월일까지 보여준다 (회원끼리는 나이만)
  showBirthDate?: boolean;
}

// 회원 프로필 상세 (회원 탭·매칭 탭·회원 홈에서 같은 모양)
// 사진은 크게 한 장 + 작은 사진들(누르면 큰 사진이 바뀜). 좌우로 넘기는 방식은 쓰지 않는다.
export default function MemberProfileView({ member, showBirthDate = false }: Props) {
  const photos = shownPhotos(member.photo_urls);
  const [mainIdx, setMainIdx] = useState(0);
  useEffect(() => setMainIdx(0), [member.photo_urls]);
  const main = photos[mainIdx];

  const genderLabel = member.gender === 'M' ? '남성' : member.gender === 'F' ? '여성' : null;
  const summary = [genderLabel, member.age && `${member.age}세`, member.location].filter(Boolean).join(' · ');

  const facts: [string, string, string | null | undefined][] = [
    ['📏', '키', member.height ? `${member.height}cm` : null],
    ['🎓', '학력', member.education],
    ...(showBirthDate ? ([['🎂', '생년월일', member.birth_date]] as [string, string, string | undefined][]) : []),
    ['🧍', '체형', member.body_type],
  ];
  const shownFacts = facts.filter(([, , v]) => !!v);
  const habits: [string, string | undefined][] = [
    ['종교', member.religion],
    ['흡연', member.smoking],
    ['음주', member.drinking],
  ];
  const shownHabits = habits.filter(([, v]) => !!v);

  return (
    <View>
      {/* 대표 사진 + 요약 */}
      <View style={styles.hero}>
        {main ? (
          <ProtectedPhoto uri={main} style={styles.mainPhoto} />
        ) : (
          <View style={[styles.mainPhoto, styles.noPhoto]}>
            <Text style={styles.noPhotoIcon}>👤</Text>
            <Text style={styles.noPhotoText}>사진 없음</Text>
          </View>
        )}
        <View style={styles.heroText}>
          <Text style={styles.name} numberOfLines={1}>{member.name}</Text>
          {!!summary && <Text style={styles.summary}>{summary}</Text>}
          {!!member.job && <Text style={styles.jobLine} numberOfLines={2}>{member.job}</Text>}
          {photos.length > 1 && (
            <View style={styles.thumbs}>
              {photos.map((url, i) => (
                <Pressable key={url} onPress={() => setMainIdx(i)} accessibilityLabel={`사진 ${i + 1} 크게 보기`}>
                  <ProtectedPhoto uri={url} small style={[styles.thumb, i === mainIdx && styles.thumbOn]} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* 기본 정보: 입력한 항목만 두 칸씩 */}
      <Text style={styles.sectionTitle}>기본 정보</Text>
      {shownFacts.length ? (
        <View style={styles.grid}>
          {shownFacts.map(([icon, label, value]) => (
            <View key={label} style={styles.tile}>
              <Text style={styles.tileLabel}>{icon} {label}</Text>
              <Text style={styles.tileValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>아직 입력한 정보가 없어요</Text>
      )}

      {!!member.bio && (
        <>
          <Text style={styles.sectionTitle}>자기소개</Text>
          <View style={styles.bioBox}>
            <Text style={styles.bioText}>{member.bio}</Text>
          </View>
        </>
      )}

      {shownHabits.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>생활습관</Text>
          <View style={styles.chips}>
            {shownHabits.map(([label, value]) => (
              <View key={label} style={styles.chip}>
                <Text style={styles.chipLabel}>{label}</Text>
                <Text style={styles.chipValue}>{value}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    gap: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F7F4FF',
    marginBottom: 8,
  },
  mainPhoto: { width: 120, height: 150, borderRadius: 12, backgroundColor: '#E9E2FF' },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  noPhotoIcon: { fontSize: 40 },
  noPhotoText: { fontSize: 11, color: '#9A8CC9', marginTop: 4 },
  heroText: { flex: 1, justifyContent: 'center' },
  name: { fontSize: 20, fontWeight: '700', color: '#222' },
  summary: { fontSize: 14, color: '#5B21FF', fontWeight: '600', marginTop: 4 },
  jobLine: { fontSize: 13, color: '#666', marginTop: 6 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  thumb: { width: 40, height: 40, borderRadius: 8, opacity: 0.6 },
  thumbOn: { opacity: 1, borderWidth: 2, borderColor: '#5B21FF' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tileLabel: { fontSize: 12, color: '#888' },
  tileValue: { fontSize: 14, fontWeight: '600', color: '#222', marginTop: 4 },
  empty: { fontSize: 13, color: '#999' },
  bioBox: { borderLeftWidth: 3, borderLeftColor: '#5B21FF', backgroundColor: '#FAFAFC', borderRadius: 8, padding: 12 },
  bioText: { fontSize: 14, color: '#444', lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', gap: 6, borderRadius: 16, backgroundColor: '#F3F3F5', paddingHorizontal: 12, paddingVertical: 7 },
  chipLabel: { fontSize: 13, color: '#888' },
  chipValue: { fontSize: 13, fontWeight: '600', color: '#333' },
});
