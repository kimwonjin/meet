// 결혼중개계약서 시트: 첫 구매 전에는 '동의하고 결제하기', 다시 볼 때는 읽기만
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { useBusiness } from '@/lib/business';
import { contractSections, ContractInfo } from '@/lib/contract';

export default function ContractSheet({ visible, onClose, info, onAgree, busy }: { visible: boolean; onClose: () => void; info: ContractInfo; onAgree?: () => void; busy?: boolean }) {
  useBusiness();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="결혼중개계약서"
      footer={onAgree ? (
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.7 }]} onPress={onAgree} disabled={busy} accessibilityLabel="계약서에 동의하고 결제하기">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>동의하고 결제하기</Text>}
        </TouchableOpacity>
      ) : undefined}
    >
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text style={s.lead}>{onAgree ? '처음 이용권을 살 때 한 번 확인해요. 동의하면 이 계약서가 내 계정에 보관되고, 마이 › 이용권/결제에서 언제든 다시 볼 수 있어요.' : '이용권을 처음 살 때 동의한 결혼중개계약서예요.'}</Text>
        {contractSections(info).map((sec) => (
          <View key={sec.heading}>
            <Text style={s.h}>{sec.heading}</Text>
            <Text style={s.body}>{sec.body}</Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 13, color: '#54515A', lineHeight: 19, backgroundColor: '#F7F4FF', borderRadius: 10, padding: 12 },
  h: { fontSize: 14, fontWeight: '700', color: '#322F38', marginBottom: 4 },
  body: { fontSize: 13, color: '#434049', lineHeight: 20 },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
