import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { TERMS_DOCS, TERMS_VERSION, TermsDocKey } from '@/lib/terms';

// 약관 전문 보기
export default function TermsSheet({ docKey, onClose }: { docKey: TermsDocKey | null; onClose: () => void }) {
  const doc = docKey ? TERMS_DOCS[docKey] : null;
  return (
    <BottomSheet visible={doc !== null} onClose={onClose} title={doc?.title ?? ''}>
      {doc && (
        <View>
          <Text style={styles.version}>시행일 {TERMS_VERSION}</Text>
          {doc.sections.map((s) => (
            <View key={s.heading} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  version: { fontSize: 12, color: '#999', marginBottom: 12 },
  section: { marginBottom: 18 },
  heading: { fontSize: 14, fontWeight: '700', color: '#222', marginBottom: 6 },
  body: { fontSize: 13, color: '#555', lineHeight: 21 },
});
