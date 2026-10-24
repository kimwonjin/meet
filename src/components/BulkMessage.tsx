// 파트너 회원 탭 '여러 회원에게 보내기' 줄 + 시트: 받을 회원 고르기 → 글 쓰기(자주 쓰는 문구 불러오기) → 보내기
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { loadPhrases } from '@/lib/quickPhrases';
import { BULK_MAX_PEOPLE, BULK_MAX_PER_DAY, bulkSentToday, NAME_TOKEN, sendBulk } from '@/lib/bulkMessage';

type Member = { id: string; name: string; sub?: string };

export function BulkMessageRow({ members, style }: { members: Member[]; style?: any }) {
  const [open, setOpen] = useState(false);
  if (members.length < 2) return null;
  return (
    <>
      <TouchableOpacity style={[s.row, style]} onPress={() => setOpen(true)} accessibilityLabel="여러 회원에게 보내기">
        <Text style={s.rowT}>✉️ 여러 회원에게 보내기</Text>
        <Text style={s.rowSub}>연휴·안내 메시지 ›</Text>
      </TouchableOpacity>
      <BulkMessageSheet visible={open} onClose={() => setOpen(false)} members={members} />
    </>
  );
}

function BulkMessageSheet({ visible, onClose, members }: { visible: boolean; onClose: () => void; members: Member[] }) {
  const { user } = useAuth();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [phrases, setPhrases] = useState<string[] | null>(null);
  const [showPhrases, setShowPhrases] = useState(false);
  const [usedToday, setUsedToday] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    setPicked(new Set()); setQ(''); setShowPhrases(false); setProgress(null);
    bulkSentToday(user.id).then(setUsedToday);
  }, [visible]);

  const shown = useMemo(() => {
    const t = q.trim();
    return t ? members.filter((m) => m.name.includes(t)) : members;
  }, [members, q]);
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else if (n.size >= BULK_MAX_PEOPLE) toast.show(`한 번에 ${BULK_MAX_PEOPLE}명까지 보낼 수 있어요`, 'info');
    else n.add(id);
    return n;
  });
  const pickAll = () => setPicked(new Set(shown.slice(0, BULK_MAX_PEOPLE).map((m) => m.id)));

  const left = BULK_MAX_PER_DAY - usedToday;
  const busy = progress !== null;
  const canSend = !busy && picked.size > 0 && !!text.trim() && left > 0;

  async function send() {
    if (!user || !canSend) return;
    setProgress(0);
    try {
      const list = members.filter((m) => picked.has(m.id));
      const r = await sendBulk(user.id, list, text.trim(), setProgress);
      if (r.sent) {
        toast.show(`✓ ${r.sent}명에게 보냈어요${r.skipped ? ` · ${r.skipped}명은 보낼 수 없어 건너뛰었어요` : ''}`, 'success');
        setText('');
        onClose();
      } else {
        toast.show('보낼 수 있는 회원이 없었어요', 'info');
      }
    } catch {
      toast.show('보내지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    } finally {
      setProgress(null);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title="여러 회원에게 보내기"
      footer={
        <TouchableOpacity style={[s.btn, !canSend && { opacity: 0.5 }]} onPress={send} disabled={!canSend} accessibilityLabel="여러 회원에게 보내기 확정">
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#fff" />
              <Text style={s.btnT}>보내는 중 {progress}/{picked.size}</Text>
            </View>
          ) : (
            <Text style={s.btnT}>{left <= 0 ? '오늘은 더 보낼 수 없어요' : picked.size ? `${picked.size}명에게 보내기` : '받을 회원을 골라 주세요'}</Text>
          )}
        </TouchableOpacity>
      }
    >
      <View style={{ gap: 12, paddingBottom: 4 }}>
        <View>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={(t) => setText(t.slice(0, 500))}
            placeholder={`보낼 글 (예: ${NAME_TOKEN}님, 연휴 동안은 답이 늦어요)`}
            placeholderTextColor="#BAB7C0"
            multiline
            accessibilityLabel="보낼 글"
          />
          <View style={s.textFoot}>
            <Text style={s.hint}>{NAME_TOKEN}을 넣으면 회원 이름으로 바뀌어요</Text>
            <TouchableOpacity onPress={() => { setShowPhrases(!showPhrases); if (!phrases && user) loadPhrases(user.id, user.name).then(setPhrases); }} hitSlop={8} accessibilityLabel="자주 쓰는 문구 불러오기">
              <Text style={s.link}>문구 불러오기 {showPhrases ? '▴' : '▾'}</Text>
            </TouchableOpacity>
          </View>
          {showPhrases && (
            <View style={s.phraseBox}>
              {!phrases ? <ActivityIndicator color="#5B21FF" /> : phrases.length === 0 ? <Text style={s.hint}>저장한 문구가 없어요</Text> : phrases.map((p) => (
                <TouchableOpacity key={p} onPress={() => { setText(p); setShowPhrases(false); }} style={s.phraseRow} accessibilityLabel={`문구 넣기 ${p}`}>
                  <Text style={s.phraseT} numberOfLines={2}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={s.listHead}>
          <Text style={s.listTitle}>받을 회원 {picked.size}/{Math.min(BULK_MAX_PEOPLE, members.length)}명</Text>
          <TouchableOpacity onPress={picked.size ? () => setPicked(new Set()) : pickAll} hitSlop={8} accessibilityLabel={picked.size ? '모두 빼기' : '모두 고르기'}>
            <Text style={s.link}>{picked.size ? '모두 빼기' : members.length > BULK_MAX_PEOPLE ? `${BULK_MAX_PEOPLE}명 고르기` : '모두 고르기'}</Text>
          </TouchableOpacity>
        </View>
        {members.length > 8 && (
          <TextInput style={s.search} value={q} onChangeText={setQ} placeholder="🔍 이름으로 찾기" placeholderTextColor="#BAB7C0" accessibilityLabel="받을 회원 찾기" />
        )}
        <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
          {shown.map((m) => {
            const on = picked.has(m.id);
            return (
              <TouchableOpacity key={m.id} style={s.member} onPress={() => toggle(m.id)} accessibilityLabel={`${on ? '빼기' : '고르기'} ${m.name}`} accessibilityState={{ checked: on }}>
                <View style={[s.check, on && s.checkOn]}>{on && <Text style={s.checkT}>✓</Text>}</View>
                <Text style={s.memberName}>{m.name}</Text>
                {!!m.sub && <Text style={s.memberSub} numberOfLines={1}>{m.sub}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={s.note}>회원마다 1:1 채팅으로 따로 가요. 하루 {BULK_MAX_PER_DAY}번까지 보낼 수 있어요{left < BULK_MAX_PER_DAY ? ` (오늘 ${Math.max(0, left)}번 남음)` : ''}</Text>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#ECEAF1', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12 },
  rowT: { fontSize: 14, fontWeight: '600', color: '#322F38' },
  rowSub: { fontSize: 12, color: '#87848D' },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 12, padding: 12, minHeight: 88, fontSize: 14, color: '#322F38', textAlignVertical: 'top' },
  textFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  hint: { fontSize: 12, color: '#98959E' },
  link: { fontSize: 13, color: '#5B21FF', fontWeight: '600' },
  phraseBox: { marginTop: 8, backgroundColor: '#FAF9FC', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  phraseRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  phraseT: { fontSize: 13, color: '#322F38', lineHeight: 19 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listTitle: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  search: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, paddingHorizontal: 12, height: 40, fontSize: 14, color: '#322F38' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F4F2F7' },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#C9C5D0', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#5B21FF', borderColor: '#5B21FF' },
  checkT: { color: '#fff', fontSize: 13, fontWeight: '800' },
  memberName: { fontSize: 14, color: '#322F38', fontWeight: '600' },
  memberSub: { flex: 1, fontSize: 12, color: '#98959E', textAlign: 'right' },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18 },
});
