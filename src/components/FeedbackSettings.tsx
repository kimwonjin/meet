// '의견 보내기': 마이 메뉴 줄 + 작성 시트 (모든 역할)
// 운영자 현황 탭에서는 받은 의견 목록(FeedbackInbox)으로 본다
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { feedbackAvailable, fetchFeedback, getLastScreen, screenName, sendFeedback, setFeedbackDone } from '@/lib/feedback';
import { pickAndUploadPhoto } from '@/lib/photos';
import { timeAgo } from '@/lib/notifications';

export function FeedbackMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const { user } = useAuth();
  const toast = useToast();
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  useFocusEffect(useCallback(() => { feedbackAvailable().then(setAvailable).catch(() => {}); }, []));
  if (!available || !user || user.role === 'operator') return null;

  async function attach() {
    if (!user || uploading) return;
    setUploading(true);
    try {
      const url = await pickAndUploadPhoto(user.id, { crop: false, folder: 'feedback' });
      if (url) setPhoto(url);
    } catch (e: any) {
      toast.show(e?.message || '사진을 올리지 못했어요', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!user || sending) return;
    if (message.trim().length < 2) { toast.show('내용을 조금 더 적어 주세요', 'error'); return; }
    setSending(true);
    const ok = await sendFeedback(user, message, photo);
    setSending(false);
    if (!ok) { toast.show('보내지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    setMessage(''); setPhoto(null); setOpen(false);
    toast.show('✓ 보내 주셔서 고마워요. 꼼꼼히 확인할게요', 'success');
  }

  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => setOpen(true)} accessibilityLabel="의견 보내기">
        <Text style={m.menuIcon}>💬</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>의견 보내기</Text>
          <Text style={m.menuSub}>불편한 점이나 바라는 점을 알려 주세요</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="의견 보내기"
        footer={
          <TouchableOpacity style={[s.btn, (sending || message.trim().length < 2) && { opacity: 0.6 }]} onPress={send} disabled={sending || uploading} accessibilityLabel="의견 보내기 확정">
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>보내기</Text>}
          </TouchableOpacity>
        }
      >
        <View style={{ gap: 10, paddingBottom: 4 }}>
          <Text style={s.lead}>운영팀이 직접 읽어요. 어떤 화면에서 무엇을 하다가 생긴 일인지 적어 주시면 더 빨리 고칠 수 있어요</Text>
          <TextInput
            style={s.input}
            value={message}
            onChangeText={setMessage}
            placeholder="예: 매칭 화면에서 날짜를 고르면 저장이 안 돼요"
            placeholderTextColor="#BAB7C0"
            multiline
            maxLength={2000}
            accessibilityLabel="의견 내용"
          />
          <View style={s.row}>
            {photo ? (
              <View style={s.photoRow}>
                <Image source={{ uri: photo }} style={s.thumb} />
                <TouchableOpacity onPress={() => setPhoto(null)} accessibilityLabel="붙인 사진 빼기"><Text style={s.remove}>빼기</Text></TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.attach} onPress={attach} disabled={uploading} accessibilityLabel="화면 사진 붙이기">
                {uploading ? <ActivityIndicator size="small" color="#5B21FF" /> : <Text style={s.attachT}>📎 화면 사진 붙이기 (선택)</Text>}
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.meta}>보던 화면: {screenName(getLastScreen())} · 보낸 사람과 화면 정보가 함께 전달돼요</Text>
        </View>
      </BottomSheet>
    </>
  );
}

// 운영자: 받은 의견 (처리 전이 먼저)
export function FeedbackInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(() => { fetchFeedback(50).then(setRows).catch(() => setRows(null)); }, []);
  useFocusEffect(load);
  useEffect(load, [load]);
  if (rows === null) return null; // SQL 전이면 숨김

  // 메모 없이 이유만 고른 탈퇴는 위 '최근 탈퇴 이유'에 모이므로 처리할 의견 목록에는 넣지 않는다
  const actionable = rows.filter((r) => !(r.screen === 'withdraw' && !String(r.message || '').includes(' · ')));
  const open = actionable.filter((r) => r.status !== 'done');
  const done = actionable.filter((r) => r.status === 'done');
  const list = showDone ? [...open, ...done] : open;

  async function toggle(r: any) {
    const ok = await setFeedbackDone(r.id, r.status !== 'done');
    if (!ok) { toast.show('바꾸지 못했어요', 'error'); return; }
    setRows((prev) => (prev || []).map((x) => (x.id === r.id ? { ...x, status: r.status === 'done' ? 'open' : 'done' } : x)));
  }

  return (
    <View>
      <Text style={s.h2}>받은 의견 <Text style={open.length ? s.h2Count : s.h2Zero}>{open.length ? `${open.length}건` : '없어요'}</Text></Text>
      {/* 최근 탈퇴 이유 모아 보기 (탈퇴 시 고른 이유) */}
      {(() => {
        const counts = new Map<string, number>();
        for (const r of rows.filter((x) => x.screen === 'withdraw')) {
          const m = String(r.message || '').match(/^\[탈퇴\] ([^·]*)/);
          for (const reason of (m?.[1] || '').split(',').map((t: string) => t.trim()).filter((t: string) => t && t !== '이유 없음')) counts.set(reason, (counts.get(reason) || 0) + 1);
        }
        if (!counts.size) return null;
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
        return <Text style={s.withdrawSum}>최근 탈퇴 이유: {top}</Text>;
      })()}
      <View style={s.card}>
        {list.length === 0 ? <Text style={s.empty}>처리할 의견이 없어요</Text> : list.map((r) => (
          <View key={r.id} style={[s.item, r.status === 'done' && { opacity: 0.55 }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.itemHead}>{r.userName} · {r.role === 'connector' ? '파트너' : '회원'} · {screenName(r.screen)} · {timeAgo(r.created_at)}</Text>
              <Text style={s.itemMsg}>{r.message}</Text>
              {!!r.photo_url && (
                <TouchableOpacity onPress={() => Linking.openURL(r.photo_url)} accessibilityLabel="붙인 사진 보기">
                  <Text style={s.photoLink}>📎 붙인 사진 보기</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={[s.doneBtn, r.status === 'done' && s.doneBtnOn]} onPress={() => toggle(r)} accessibilityLabel={r.status === 'done' ? '처리 완료 취소' : '처리 완료'}>
              <Text style={[s.doneBtnT, r.status === 'done' && s.doneBtnTOn]}>{r.status === 'done' ? '✓ 완료' : '처리 완료'}</Text>
            </TouchableOpacity>
          </View>
        ))}
        {done.length > 0 && (
          <TouchableOpacity onPress={() => setShowDone(!showDone)} style={{ paddingVertical: 10 }}>
            <Text style={s.more}>{showDone ? '처리한 의견 숨기기' : `처리한 의견 ${done.length}건 보기`}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  withdrawSum: { fontSize: 12, color: '#65626B', marginHorizontal: 20, marginBottom: 8, lineHeight: 18 },
  lead: { fontSize: 13, color: '#65626B', lineHeight: 19 },
  input: { minHeight: 120, borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, padding: 12, fontSize: 14, color: '#322F38', textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  attach: { borderWidth: 1, borderColor: '#DCD9E2', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  attachT: { fontSize: 13, color: '#65626B' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#F1EFF4' },
  remove: { fontSize: 13, color: '#736F7A' },
  meta: { fontSize: 11, color: '#736F7A' },
  btn: { backgroundColor: '#5B21FF', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 16, fontWeight: '700' },
  h2: { fontSize: 15, fontWeight: '700', color: '#322F38', marginHorizontal: 20, marginTop: 24, marginBottom: 8 },
  h2Count: { color: '#5B21FF' },
  h2Zero: { color: '#736F7A', fontWeight: '400', fontSize: 13 },
  card: { marginHorizontal: 20, borderWidth: 1, borderColor: '#EFEDF2', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  empty: { fontSize: 13, color: '#6E6A75', paddingVertical: 12 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F3F8' },
  itemHead: { fontSize: 11, color: '#736F7A' },
  itemMsg: { fontSize: 14, color: '#322F38', lineHeight: 20 },
  photoLink: { fontSize: 12, color: '#5B21FF', fontWeight: '600' },
  doneBtn: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 999, paddingHorizontal: 10, height: 30, justifyContent: 'center' },
  doneBtnOn: { borderColor: '#5B21FF', backgroundColor: '#F5F1FF' },
  doneBtnT: { fontSize: 12, color: '#65626B', fontWeight: '600' },
  doneBtnTOn: { color: '#5B21FF' },
  more: { fontSize: 13, color: '#5B21FF', fontWeight: '600', textAlign: 'center' },
});
