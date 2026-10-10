import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { supabase } from '@/lib/supabase';
import { viewerCode } from '@/lib/watermark';

const ROLE: Record<string, string> = { hopeful: '회원', connector: '파트너', operator: '운영자' };

// 운영자: 유출된 캡처 사진 하단의 번호(예: 두두인연 A7C2E9F1)로 누가 본 화면인지 찾는다
export default function WatermarkLookupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; name: string; phone: string; role: string }[] | null>(null);

  // '두두인연 A7C2E9F1 10/07 14:30'처럼 통째로 붙여넣어도 8자리 번호만 골라낸다
  const picked = (code.match(/[0-9a-fA-F]{8}/) || [''])[0].toUpperCase();

  async function search() {
    const c = picked;
    if (!c || busy) return;
    setBusy(true);
    // 번호 = 회원 고유번호 앞 8자리 → 그 범위만 서버에서 찾는다 (회원이 많아도 전부 받지 않음)
    const lo = c.toLowerCase();
    const { data } = await supabase
      .from('users')
      .select('id, name, phone, role')
      .gte('id', `${lo}-0000-0000-0000-000000000000`)
      .lte('id', `${lo}-ffff-ffff-ffff-ffffffffffff`);
    setResult((data || []).filter((u: any) => viewerCode(u.id) === c));
    setBusy(false);
  }

  function close() {
    setCode('');
    setResult(null);
    onClose();
  }

  const valid = !!picked;
  return (
    <BottomSheet visible={visible} onClose={close} title="워터마크 번호로 회원 찾기">
      <Text style={styles.lead}>캡처된 사진 아래쪽의 '두두인연' 옆 8자리 번호를 입력하면, 그 화면을 본 사람을 찾아요.</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(t) => { setCode(t); setResult(null); }}
        placeholder="예: A7C2E9F1"
        placeholderTextColor="#BAB7C0"
        autoCapitalize="characters"
        maxLength={40}
        accessibilityLabel="워터마크 번호"
      />
      <TouchableOpacity style={[styles.primary, (!valid || busy) && styles.disabled]} onPress={search} disabled={!valid || busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>찾기</Text>}
      </TouchableOpacity>
      {result && (
        result.length === 0 ? (
          <Text style={styles.empty}>이 번호의 회원이 없어요. 번호를 다시 확인해 주세요.</Text>
        ) : (
          <View style={styles.results}>
            {result.map((u) => (
              <View key={u.id} style={styles.row}>
                <Text style={styles.name}>{u.name} <Text style={styles.role}>{ROLE[u.role] ?? u.role}</Text></Text>
                <Text style={styles.phone}>{u.phone}</Text>
              </View>
            ))}
          </View>
        )
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, color: '#65626B', lineHeight: 19, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, letterSpacing: 1, color: '#211E27' },
  primary: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  empty: { fontSize: 13, color: '#87848D', marginTop: 16, textAlign: 'center' },
  results: { marginTop: 16, gap: 8 },
  row: { backgroundColor: '#F7F5FA', borderRadius: 10, padding: 12 },
  name: { fontSize: 15, fontWeight: '700', color: '#211E27' },
  role: { fontSize: 12, fontWeight: '400', color: '#87848D' },
  phone: { fontSize: 13, color: '#54515A', marginTop: 4 },
});
