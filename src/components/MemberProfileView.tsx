import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PhotoList } from './ProfilePhoto';

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

// 회원 프로필 상세 (회원 탭·매칭 탭에서 같은 모양으로 보여준다)
export default function MemberProfileView({ member }: { member: MemberProfile }) {
  const row = (label: string, value?: string | number | null) => (
    <View style={styles.infoRow} key={label}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '-'}</Text>
    </View>
  );
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{member.name}</Text>
      </View>

      <PhotoList photoUrls={member.photo_urls} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>기본 정보</Text>
        {row('성별 · 나이', [member.gender === 'M' ? '남' : member.gender === 'F' ? '여' : null, member.age && `${member.age}세`].filter(Boolean).join(' · '))}
        {row('생년월일', member.birth_date)}
        {row('키', member.height ? `${member.height}cm` : null)}
        {row('지역', member.location)}
        {row('직업', member.job)}
        {row('학력', member.education)}
      </View>

      {!!member.bio && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>자기소개</Text>
          <Text style={styles.bioText}>{member.bio}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>생활습관</Text>
        {row('종교', member.religion)}
        {row('흡연', member.smoking)}
        {row('음주', member.drinking)}
        {row('체형', member.body_type)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '700', color: '#333' },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 13, color: '#666' },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#333' },
  bioText: { fontSize: 13, color: '#666', lineHeight: 20 },
});
