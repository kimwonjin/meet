import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BUSINESS, businessInfoReady } from '@/lib/business';

// 화면 맨 아래 사업자 정보 (통신판매업자 표시 의무). 값이 다 채워지기 전에는 보이지 않는다.
export default function BusinessInfo() {
  if (!businessInfoReady()) return null;
  const b = BUSINESS;
  const contact = [b.phone, b.email].filter(Boolean).join(' · ');
  return (
    <View style={styles.wrap}>
      <Text style={styles.line}>{b.companyName} | 대표 {b.ceo} | 사업자등록번호 {b.bizNumber}</Text>
      <Text style={styles.line}>통신판매업 신고 {b.mailOrderNumber}</Text>
      <Text style={styles.line}>{b.address}</Text>
      <Text style={styles.line}>고객센터 {contact}</Text>
      {!!b.privacyOfficer && <Text style={styles.line}>개인정보 보호책임자 {b.privacyOfficer}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 16, paddingHorizontal: 20, gap: 2 },
  line: { fontSize: 11, color: '#aaa', lineHeight: 16, textAlign: 'center' },
});
