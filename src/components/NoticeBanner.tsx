// 홈 위쪽 운영자 공지 한 줄: 2주 안에 받은 안 읽은 공지 중 가장 최근 것. 누르면 펼치고 '확인'하면 읽음 처리
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { markOneRead, timeAgo } from '@/lib/notifications';

const NOTICE_DAYS = 14;

export default function NoticeBanner() {
  const { user } = useAuth();
  const [notice, setNotice] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let alive = true;
    const since = new Date(Date.now() - NOTICE_DAYS * 86400000).toISOString();
    supabase.from('notifications').select('id, title, body, created_at').eq('user_id', user.id).eq('type', 'notice')
      .is('read_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (alive) setNotice(data?.[0] || null); });
    return () => { alive = false; };
  }, [user?.id]));

  if (!notice) return null;
  const title = String(notice.title || '').replace(/^📢\s*/, '');

  async function done() {
    setBusy(true);
    await markOneRead(notice.id);
    setBusy(false); setNotice(null); setOpen(false);
  }

  return (
    <View style={s.box}>
      <TouchableOpacity onPress={() => setOpen(!open)} accessibilityLabel={open ? '공지 접기' : '공지 펼치기'}>
        <Text style={s.title} numberOfLines={open ? undefined : 1}>📢 {title}</Text>
        {!!notice.body && <Text style={s.body} numberOfLines={open ? undefined : 1}>{notice.body}</Text>}
      </TouchableOpacity>
      <View style={s.foot}>
        <Text style={s.when}>운영팀 · {timeAgo(notice.created_at)}{!open && notice.body ? ' · 눌러서 펼치기' : ''}</Text>
        <TouchableOpacity onPress={done} disabled={busy} hitSlop={8} accessibilityLabel="공지 확인">
          {busy ? <ActivityIndicator size="small" color="#5B21FF" /> : <Text style={s.ok}>확인</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: 12, borderRadius: 14, backgroundColor: '#F5F1FF', borderWidth: 1, borderColor: '#E4D9FF', paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  title: { fontSize: 14, fontWeight: '700', color: '#322F38', lineHeight: 20 },
  body: { fontSize: 13, color: '#54515A', lineHeight: 19 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  when: { fontSize: 12, color: '#736F7A' },
  ok: { fontSize: 13, fontWeight: '700', color: '#5B21FF' },
});
