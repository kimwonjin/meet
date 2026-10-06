import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { useToast } from '@/contexts/ToastContext';
import { BUSINESS, BusinessKey, businessTableReady, loadBusiness, saveBusiness } from '@/lib/business';

const FIELDS: { key: BusinessKey; label: string; placeholder: string; hint?: string }[] = [
  { key: 'reportNumber', label: '국내결혼중개업 신고번호', placeholder: '예: 서울-강남-국내-2026-0001', hint: '이 번호를 넣어야 초대 링크에 파트너 소개가 보여요. 비어 있으면 가입 화면만 보여요.' },
  { key: 'companyName', label: '상호', placeholder: '예: 두두인연' },
  { key: 'ceo', label: '대표자', placeholder: '홍길동' },
  { key: 'bizNumber', label: '사업자등록번호', placeholder: '123-45-67890' },
  { key: 'mailOrderNumber', label: '통신판매업 신고번호', placeholder: '제2026-서울강남-0000호' },
  { key: 'address', label: '사업장 주소', placeholder: '서울시 ○○구 ○○로 00' },
  { key: 'phone', label: '고객센터 전화', placeholder: '02-000-0000' },
  { key: 'email', label: '고객센터 이메일', placeholder: 'help@dodoinyeon.com' },
  { key: 'privacyOfficer', label: '개인정보 보호책임자', placeholder: '이름' },
  { key: 'privacyContact', label: '개인정보 보호책임자 연락처', placeholder: '이메일 또는 전화' },
];

// 운영자 설정 › 사업자 정보: 화면 하단 사업자 정보·약관·초대 링크 공개 여부에 쓰인다
export default function BusinessSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<BusinessKey, string>>({ ...BUSINESS });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoaded(false);
    loadBusiness(true).then(() => {
      setValues({ ...BUSINESS });
      setLoaded(true);
    });
  }, [visible]);

  async function save() {
    if (saving) return;
    setSaving(true);
    const r = await saveBusiness(values);
    setSaving(false);
    if (r === 'ok') {
      toast.show('✓ 사업자 정보를 저장했어요', 'success');
      onClose();
    } else if (r === 'not_ready') {
      toast.show('아직 저장할 수 없어요. 안내받은 SQL을 먼저 실행해주세요', 'error');
    } else {
      toast.show('저장하지 못했어요. 잠시 후 다시 시도해주세요', 'error');
    }
  }

  return (
    <BottomSheet visible={visible} onClose={() => !saving && onClose()} title="사업자 정보">
      {!loaded ? (
        <ActivityIndicator color="#5B21FF" style={{ marginVertical: 40 }} />
      ) : (
        <View>
          <Text style={styles.lead}>화면 맨 아래와 약관에 표시돼요. 비어 있는 칸은 표시하지 않아요.</Text>
          {!businessTableReady() && (
            <Text style={styles.warn}>저장 공간이 아직 준비되지 않았어요. 안내받은 SQL을 실행하면 저장할 수 있어요.</Text>
          )}
          {FIELDS.map((f) => (
            <View key={f.key} style={styles.field}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={styles.input}
                value={values[f.key]}
                onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
                placeholder={f.placeholder}
                placeholderTextColor="#bbb"
                maxLength={120}
                accessibilityLabel={f.label}
              />
              {!!f.hint && <Text style={styles.hint}>{f.hint}</Text>}
            </View>
          ))}
          <TouchableOpacity style={[styles.primary, saving && styles.disabled]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>저장하기</Text>}
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 12 },
  warn: { fontSize: 13, color: '#E53935', lineHeight: 19, marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#222' },
  hint: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 17 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
