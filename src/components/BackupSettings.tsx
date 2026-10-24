// 운영자 '전체 백업 내려받기' (설정 메뉴 줄 + 시트) · 현황 탭의 백업 알림 줄
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useToast } from '@/contexts/ToastContext';
import { BACKUP_REMIND_DAYS, BACKUP_TABLES, buildBackup, BackupResult, downloadBackup, getLastBackupAt } from '@/lib/backup';

const daysAgo = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const lastLabel = (iso: string | null) => {
  const d = daysAgo(iso);
  return d === null ? '이 기기에서 받은 적 없음' : d === 0 ? '오늘 받음' : `${d}일 전에 받음`;
};

function useLastBackup() {
  const [last, setLast] = useState<string | null>(null);
  const load = useCallback(() => { getLastBackupAt().then(setLast); }, []);
  useFocusEffect(load);
  return { last, reload: load };
}

export function BackupSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const { last, reload } = useLastBackup();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true); setResult(null);
    try {
      const r = await buildBackup((done, total) => setProgress({ done, total }));
      setResult(r);
      if (await downloadBackup(r)) {
        toast.show('✓ 백업 파일을 받았어요', 'success');
        reload(); onDone?.();
      }
    } catch {
      toast.show('백업하지 못했어요. 잠시 후 다시 시도해 주세요', 'error');
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={() => { if (!busy) { setResult(null); onClose(); } }} title="전체 백업 내려받기">
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text style={s.lead}>회원·파트너·매칭·결제·정산·채팅 등 {BACKUP_TABLES.length}개 표를 파일 하나로 받아요. 무료 요금제는 자동 백업이 없으니 한 달에 한 번은 받아 두세요</Text>
        <View style={s.warn}>
          <Text style={s.warnT}>🔒 전화번호 등 개인정보가 들어 있어요. 컴퓨터의 안전한 곳에만 보관하고, 메신저·메일로 보내지 마세요</Text>
        </View>
        <Text style={s.last}>마지막 백업: {lastLabel(last)}</Text>
        <TouchableOpacity style={[s.btn, busy && { opacity: 0.8 }]} onPress={run} disabled={busy} accessibilityLabel="백업 파일 받기">
          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#fff" />
              <Text style={s.btnT}>{progress ? `받는 중 ${progress.done}/${progress.total}` : '준비 중'}</Text>
            </View>
          ) : <Text style={s.btnT}>백업 파일 받기</Text>}
        </TouchableOpacity>
        {result && (
          <View style={s.box}>
            <Text style={s.boxT}>✓ {result.tables}개 표 · {result.rows.toLocaleString()}건</Text>
            <Text style={s.boxSub}>{result.fileName}</Text>
            {result.skipped.length > 0 && <Text style={s.boxSub}>아직 없는 표 {result.skipped.length}개는 건너뛰었어요: {result.skipped.join(', ')}</Text>}
          </View>
        )}
        <Text style={s.note}>알림 서명 키처럼 비밀 값은 넣지 않아요. 되살릴 일이 생기면 이 파일을 개발 담당에게 전달해 주세요</Text>
      </View>
    </BottomSheet>
  );
}

// 설정 탭 '운영 설정' 카드의 한 줄
export function BackupMenuRow({ styles: m }: { styles: { menuItem: any; menuIcon: any; menuContent: any; menuTitle: any; menuSub: any; arrow: any } }) {
  const [open, setOpen] = useState(false);
  const { last, reload } = useLastBackup();
  const d = daysAgo(last);
  const due = d === null || d >= BACKUP_REMIND_DAYS;
  return (
    <>
      <TouchableOpacity style={m.menuItem} onPress={() => setOpen(true)} accessibilityLabel="전체 백업 내려받기">
        <Text style={m.menuIcon}>💾</Text>
        <View style={m.menuContent}>
          <Text style={m.menuTitle}>전체 백업 내려받기</Text>
          <Text style={[m.menuSub, due && { color: '#E5484D' }]}>{lastLabel(last)}{due ? ' · 받아 두세요' : ''}</Text>
        </View>
        <Text style={m.arrow}>›</Text>
      </TouchableOpacity>
      <BackupSheet visible={open} onClose={() => setOpen(false)} onDone={reload} />
    </>
  );
}

// 현황 탭: 한 달 넘게 백업하지 않았으면 한 줄로 알린다
export function BackupReminder({ style }: { style?: any }) {
  const [open, setOpen] = useState(false);
  const { last, reload } = useLastBackup();
  const d = daysAgo(last);
  const due = d === null || d >= BACKUP_REMIND_DAYS;
  // 받고 나면 줄은 숨기지만, 결과를 볼 수 있게 시트는 닫을 때까지 남긴다
  if (!due && !open) return null;
  return (
    <>
      {due && (
        <TouchableOpacity style={[s.remind, style]} onPress={() => setOpen(true)} accessibilityLabel="백업하기">
          <Text style={s.remindT}>💾 {d === null ? '아직 백업을 받지 않았어요' : `백업한 지 ${d}일이 지났어요`}</Text>
          <Text style={s.remindBtn}>백업하기 ›</Text>
        </TouchableOpacity>
      )}
      <BackupSheet visible={open} onClose={() => setOpen(false)} onDone={reload} />
    </>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 14, color: '#434049', lineHeight: 21 },
  warn: { backgroundColor: '#FFF6E5', borderRadius: 12, padding: 12 },
  warnT: { fontSize: 13, color: '#7A5A00', lineHeight: 19 },
  last: { fontSize: 13, color: '#87848D' },
  btn: { height: 52, borderRadius: 12, backgroundColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  btnT: { fontSize: 16, fontWeight: '700', color: '#fff' },
  box: { backgroundColor: '#F8F7FA', borderRadius: 12, padding: 12, gap: 4 },
  boxT: { fontSize: 14, fontWeight: '700', color: '#322F38' },
  boxSub: { fontSize: 12, color: '#87848D', lineHeight: 18 },
  note: { fontSize: 12, color: '#98959E', lineHeight: 18 },
  remind: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#F5C2C4', backgroundColor: '#FFF6F6', paddingHorizontal: 16, paddingVertical: 12 },
  remindT: { fontSize: 14, color: '#322F38', fontWeight: '600', flexShrink: 1 },
  remindBtn: { fontSize: 13, color: '#E5484D', fontWeight: '700', marginLeft: 8 },
});
