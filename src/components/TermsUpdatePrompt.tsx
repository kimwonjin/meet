// 약관이 바뀌었을 때 기존 회원·파트너에게 바뀐 점을 보여 주고 다시 동의받는다 (약관 제3조)
// 예전 버전에 동의한 기록이 있는 사람에게만 뜬다. 닫으면 다음에 앱을 열 때 다시 알린다
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import TermsSheet from './TermsSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { outdatedConsents, PARTNER_TERMS_CHANGES, recordConsents, TERMS_CHANGES, TERMS_DOCS, TERMS_VERSION, TermsDocKey } from '@/lib/terms';

let shownThisSession = false;

export default function TermsUpdatePrompt() {
  const { user } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState<TermsDocKey[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewDoc, setViewDoc] = useState<TermsDocKey | null>(null);

  useEffect(() => {
    if (!user || shownThisSession || (user.role !== 'hopeful' && user.role !== 'connector')) return;
    const need: TermsDocKey[] = user.role === 'connector' ? ['service', 'privacy', 'partner'] : ['service', 'privacy'];
    let alive = true;
    outdatedConsents(user.id, need).then((d) => {
      if (!alive || !d.length) return;
      shownThisSession = true;
      setDocs(d);
      setOpen(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id, user?.role]);

  if (!user || !docs.length) return null;
  const changes = [...TERMS_CHANGES, ...(docs.includes('partner') ? PARTNER_TERMS_CHANGES : [])];

  async function agree() {
    if (!user || busy) return;
    setBusy(true);
    const { error } = await recordConsents(user.id, docs);
    setBusy(false);
    if (error) { toast.show('저장하지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    setOpen(false);
    toast.show('✓ 바뀐 약관을 확인했어요', 'success');
  }

  return (
    <>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="약관이 바뀌었어요">
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Text style={s.lead}>{TERMS_VERSION}부터 아래 내용이 바뀌어요. 자세한 내용은 전문에서 볼 수 있어요</Text>
          <View style={s.box}>
            {changes.map((c) => (
              <View key={c} style={s.line}>
                <Text style={s.dot}>•</Text>
                <Text style={s.lineT}>{c}</Text>
              </View>
            ))}
          </View>
          <View style={s.links}>
            {docs.map((d) => (
              <TouchableOpacity key={d} onPress={() => setViewDoc(d)} accessibilityLabel={`${TERMS_DOCS[d].title} 전문 보기`} hitSlop={6}>
                <Text style={s.link}>{TERMS_DOCS[d].title} 보기 ›</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[s.btn, busy && { opacity: 0.7 }]} onPress={agree} disabled={busy} accessibilityLabel="확인하고 계속하기">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>확인하고 계속하기</Text>}
          </TouchableOpacity>
          <Text style={s.note}>닫으면 다음에 다시 알려 드려요. 바뀐 날부터 계속 이용하시면 바뀐 약관에 동의한 것으로 봐요</Text>
        </View>
      </BottomSheet>
      <TermsSheet docKey={viewDoc} onClose={() => setViewDoc(null)} />
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 14, color: '#434049', lineHeight: 21 },
  box: { backgroundColor: '#F8F7FA', borderRadius: 14, padding: 14, gap: 8 },
  line: { flexDirection: 'row', gap: 8 },
  dot: { fontSize: 13, color: '#5B21FF', lineHeight: 20, fontWeight: '800' },
  lineT: { flex: 1, fontSize: 13, color: '#322F38', lineHeight: 20 },
  links: { gap: 10 },
  link: { fontSize: 13, color: '#5B21FF', fontWeight: '600' },
  btn: { height: 52, borderRadius: 12, backgroundColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  btnT: { fontSize: 16, fontWeight: '700', color: '#fff' },
  note: { fontSize: 12, color: '#736F7A', lineHeight: 18, textAlign: 'center' },
});
