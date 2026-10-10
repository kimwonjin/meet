import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TERMS_DOCS, TermsDocKey } from '@/lib/terms';

export type ConsentItem = { key: string; label: string; doc?: TermsDocKey };

interface Props {
  items: ConsentItem[];
  checked: string[];
  onChange: (checked: string[]) => void;
  disabled?: boolean;
}

// 필수 약관 동의 체크리스트 (전체 동의 + 항목별 동의, 항목마다 전문 보기)
// 전문은 그 자리에서 펼쳐 보여준다 (시트 안에서 시트를 또 열면 웹에서 뒤에 가려진다)
export default function ConsentChecklist({ items, checked, onChange, disabled }: Props) {
  const [viewing, setViewing] = useState<TermsDocKey | null>(null);
  const allChecked = items.every((i) => checked.includes(i.key));

  function toggle(key: string) {
    onChange(checked.includes(key) ? checked.filter((k) => k !== key) : [...checked, key]);
  }

  return (
    <View style={styles.box}>
      <TouchableOpacity
        style={styles.allRow}
        disabled={disabled}
        onPress={() => onChange(allChecked ? [] : items.map((i) => i.key))}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allChecked }}
      >
        <View style={[styles.check, allChecked && styles.checkOn]}>
          {allChecked && <Text style={styles.checkMark}>✓</Text>}
        </View>
        <Text style={styles.allText}>전체 동의</Text>
      </TouchableOpacity>
      <View style={styles.divider} />
      {items.map((item) => {
        const on = checked.includes(item.key);
        return (
          <View key={item.key} style={styles.row}>
            <TouchableOpacity
              style={styles.rowMain}
              disabled={disabled}
              onPress={() => toggle(item.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.checkSmall, on && styles.checkOn]}>
                {on && <Text style={styles.checkMarkSmall}>✓</Text>}
              </View>
              <Text style={styles.rowText}>
                <Text style={styles.required}>(필수) </Text>
                {item.label}
              </Text>
            </TouchableOpacity>
            {item.doc && (
              <TouchableOpacity
                onPress={() => setViewing(viewing === item.doc ? null : item.doc!)}
                style={styles.viewBtn}
                accessibilityLabel={`${item.label} ${viewing === item.doc ? '접기' : '보기'}`}
              >
                <Text style={styles.viewText}>{viewing === item.doc ? '접기' : '보기'}</Text>
              </TouchableOpacity>
            )}
            {item.doc && viewing === item.doc && (
              <ScrollView style={styles.termsBox} nestedScrollEnabled>
                <Text style={styles.termsTitle}>{TERMS_DOCS[item.doc].title}</Text>
                {TERMS_DOCS[item.doc].sections.map((sec) => (
                  <View key={sec.heading} style={styles.termsSection}>
                    <Text style={styles.termsHeading}>{sec.heading}</Text>
                    <Text style={styles.termsBody}>{sec.body}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#EDEBF0', borderRadius: 12, padding: 14 },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  allText: { fontSize: 15, fontWeight: '700', color: '#211E27' },
  divider: { height: 1, backgroundColor: '#EFEDF2', marginVertical: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 40 },
  termsBox: { width: '100%', maxHeight: 240, borderWidth: 1, borderColor: '#EDEBF0', borderRadius: 8, padding: 12, marginBottom: 8, backgroundColor: '#F9F7FC' },
  termsTitle: { fontSize: 14, fontWeight: '700', color: '#211E27', marginBottom: 10 },
  termsSection: { marginBottom: 12 },
  termsHeading: { fontSize: 13, fontWeight: '700', color: '#322F38', marginBottom: 4 },
  termsBody: { fontSize: 12, color: '#54515A', lineHeight: 19 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowText: { flex: 1, fontSize: 13, color: '#434049' },
  required: { color: '#5B21FF', fontWeight: '600' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#CBC8D1', alignItems: 'center', justifyContent: 'center' },
  checkSmall: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#CBC8D1', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#5B21FF', borderColor: '#5B21FF' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkMarkSmall: { color: '#fff', fontSize: 11, fontWeight: '700' },
  viewBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  viewText: { fontSize: 13, color: '#87848D', textDecorationLine: 'underline' },
});
