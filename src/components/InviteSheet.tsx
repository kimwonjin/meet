import React, { useState } from 'react';
import { ActivityIndicator, Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { inviteMessage, inviteUrl } from '@/lib/invite';
import { haptic } from '@/lib/haptics';

// 마이 › 초대장 보내기: 회원 후보에게 나에게 바로 연결되는 링크를 보낸다
export default function InviteSheet({ visible, onClose, partnerName }: { visible: boolean; onClose: () => void; partnerName: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const url = inviteUrl(user.id);
  const message = inviteMessage(partnerName, user.id);

  async function copy(text: string, done: string) {
    try {
      await Clipboard.setStringAsync(text);
      haptic.success();
      toast.show(done, 'success');
    } catch {
      toast.show('복사하지 못했어요. 링크를 길게 눌러 복사해주세요', 'error');
    }
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const canShareWeb = Platform.OS !== 'web' || (typeof navigator !== 'undefined' && !!(navigator as any).share);
      if (canShareWeb) {
        await Share.share({ message, url: Platform.OS === 'ios' ? url : undefined });
      } else {
        // 공유 기능이 없는 PC 브라우저는 초대 문구를 복사해 준다
        await copy(message, '초대 문구를 복사했어요. 카톡이나 문자에 붙여넣어 보내세요');
      }
    } catch {
      // 사용자가 공유 창을 닫은 경우
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="초대장 보내기">
      <Text style={styles.lead}>링크를 받은 사람이 가입하면 <Text style={styles.bold}>나에게 바로 연결</Text>돼요. 카톡·문자로 보내보세요.</Text>

      <View style={styles.preview}>
        <Text style={styles.previewLabel}>보내지는 내용</Text>
        <Text style={styles.previewText} selectable>{message}</Text>
      </View>

      <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={share} disabled={busy} accessibilityLabel="초대장 공유하기">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>💌 초대장 보내기</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={() => copy(url, '초대 링크를 복사했어요')}>
        <Text style={styles.secondaryText}>링크만 복사하기</Text>
      </TouchableOpacity>
      <Text style={styles.help}>받은 사람이 링크를 열면 파트너 소개와 함께 가입 화면이 나와요. 가입하면 내 회원 탭의 '대기중'에 가입 요청이 들어와요.</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, color: '#444', lineHeight: 21, marginBottom: 14 },
  bold: { fontWeight: '700', color: '#5B21FF' },
  preview: { backgroundColor: '#F7F4FF', borderRadius: 12, padding: 14, marginBottom: 18 },
  previewLabel: { fontSize: 12, color: '#8B7BC8', marginBottom: 6, fontWeight: '600' },
  previewText: { fontSize: 13, color: '#333', lineHeight: 20 },
  primary: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { fontSize: 14, color: '#5B21FF', fontWeight: '600' },
  help: { fontSize: 12, color: '#999', lineHeight: 18, textAlign: 'center' },
});
