import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TermsSheet from './TermsSheet';
import { TermsDocKey } from '@/lib/terms';

export type ConsentItem = { key: string; label: string; doc?: TermsDocKey };

interface Props {
  items: ConsentItem[];
  checked: string[];
  onChange: (checked: string[]) => void;
  disabled?: boolean;
}

// 필수 약관 동의 체크리스트 (전체 동의 + 항목별 동의, 항목마다 전문 보기)
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
              <TouchableOpacity onPress={() => setViewing(item.doc!)} style={styles.viewBtn} accessibilityLabel={`${item.label} 보기`}>
                <Text style={styles.viewText}>보기</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      <TermsSheet docKey={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 14 },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  allText: { fontSize: 15, fontWeight: '700', color: '#222' },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowText: { flex: 1, fontSize: 13, color: '#444' },
  required: { color: '#5B21FF', fontWeight: '600' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  checkSmall: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#5B21FF', borderColor: '#5B21FF' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkMarkSmall: { color: '#fff', fontSize: 11, fontWeight: '700' },
  viewBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  viewText: { fontSize: 13, color: '#888', textDecorationLine: 'underline' },
});
