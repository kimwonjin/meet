import React, { useState } from 'react';
import { ActivityIndicator, Platform, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { inviteMessage, inviteUrl } from '@/lib/invite';
import InviteQr from './InviteQr';

// 마이 › 광고하기: 회원 후보에게 나에게 바로 연결되는 초대 링크를 보낸다 (홍보 도구를 이 화면에 모은다)
export default function InviteSheet({ visible, onClose, partnerName }: { visible: boolean; onClose: () => void; partnerName: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // 부가 도구는 접어 두고 하나씩 펼친다 (한 화면 한 가지 주요 행동)
  const [openTool, setOpenTool] = useState<string | null>(null);
  if (!user) return null;
  const url = inviteUrl(user.id);
  const message = inviteMessage(partnerName, user.id);

  async function copy(text: string, done: string) {
    try {
      await Clipboard.setStringAsync(text);
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
    <BottomSheet visible={visible} onClose={onClose} title="광고하기">
      <Text style={styles.section}>내 초대 링크</Text>
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

      <Text style={styles.toolsTitle}>더 많은 홍보 도구</Text>
      <ToolSection id="qr" title="QR 코드" sub="모임 공지·명함에 넣기" openTool={openTool} setOpenTool={setOpenTool}>
        <InviteQr url={url} fileName="dodoinyeon-invite-qr" />
      </ToolSection>
      <Text style={styles.help}>받은 사람이 링크를 열면 파트너 소개와 함께 가입 화면이 나와요. 가입하면 내 회원 탭의 '대기중'에 가입 요청이 들어와요.</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  toolsTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginTop: 20, marginBottom: 8 },
  section: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 8 },
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

function ToolSection({ id, title, sub, openTool, setOpenTool, children }: {
  id: string; title: string; sub: string; openTool: string | null; setOpenTool: (v: string | null) => void; children: React.ReactNode;
}) {
  const open = openTool === id;
  return (
    <View style={toolStyles.wrap}>
      <TouchableOpacity style={toolStyles.head} onPress={() => setOpenTool(open ? null : id)} accessibilityLabel={`${title} ${open ? '접기' : '펼치기'}`}>
        <View style={{ flex: 1 }}>
          <Text style={toolStyles.title}>{title}</Text>
          <Text style={toolStyles.sub}>{sub}</Text>
        </View>
        <Text style={toolStyles.arrow}>{open ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {open && <View style={toolStyles.body}>{children}</View>}
    </View>
  );
}

const toolStyles = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  title: { fontSize: 15, fontWeight: '600', color: '#222' },
  sub: { fontSize: 12, color: '#999', marginTop: 2 },
  arrow: { fontSize: 14, color: '#999' },
  body: { paddingHorizontal: 14, paddingBottom: 16 },
});
