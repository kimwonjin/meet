// 운영자 '회원·파트너 찾기': 이름이나 전화번호 뒷자리로 찾고, 한 사람의 상태를 보고, 대화·정지·해제
// 목록 → 한 사람 보기 (2단계). 정지는 같은 시트 안에서 사유를 적고 한 번 더 누른다
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import BottomSheet from './BottomSheet';
import { useToast } from '@/contexts/ToastContext';
import { FoundUser, getUserSummary, searchUsers, suspendUser, unsuspendUser, UserSummary } from '@/lib/userLookup';

const ROLE: Record<string, string> = { hopeful: '회원', connector: '파트너' };
const REQ: Record<string, string> = { approved: '승인', pending: '대기', rejected: '거절' };
const PARTNER_STATUS: Record<string, string> = { approved: '활동 중', pending: '심사 중', rejected: '반려' };
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '');

function stateOf(u: FoundUser) {
  if (u.withdrawn_at) return { label: '탈퇴', color: '#98959E' };
  if (u.suspended_at) return { label: '정지', color: '#E5484D' };
  return null;
}

export function UserLookupRow({ style }: { style?: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={[s.row, style]} onPress={() => setOpen(true)} accessibilityLabel="회원·파트너 찾기">
        <Text style={s.rowT}>🔎 회원·파트너 찾기</Text>
        <Text style={s.rowSub}>이름·번호 뒷자리로 ›</Text>
      </TouchableOpacity>
      <UserLookupSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default function UserLookupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [list, setList] = useState<FoundUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<FoundUser | null>(null);
  const [sum, setSum] = useState<UserSummary | null>(null);
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => { if (!visible) { setSel(null); setSuspending(false); } }, [visible]);

  // 입력을 멈추면 찾는다 (두 글자부터)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setList(null); return; }
    const my = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(term).then((r) => { if (my === seq.current) { setList(r); setSearching(false); } });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function openUser(u: FoundUser) {
    setSel(u); setSum(null); setSuspending(false); setReason('');
    setSum(await getUserSummary(u));
  }

  async function refreshSel(patch: Partial<FoundUser>) {
    if (!sel) return;
    const next = { ...sel, ...patch };
    setSel(next);
    setList((l) => (l ? l.map((x) => (x.id === next.id ? next : x)) : l));
    setSum(await getUserSummary(next));
  }

  async function doSuspend() {
    if (!sel || busy) return;
    const r = reason.trim();
    if (!r) { toast.show('정지 사유를 적어 주세요', 'info'); return; }
    setBusy(true);
    const res = await suspendUser(sel.id, r);
    setBusy(false);
    if (!res.ok) { toast.show('정지하지 못했어요. 잠시 후 다시 시도해 주세요', 'error'); return; }
    toast.show(`✓ 이용을 정지했어요${res.closed ? ` (만나기 전 소개 ${res.closed}건 종료)` : ''}`, 'success');
    setSuspending(false);
    await refreshSel({ suspended_at: new Date().toISOString(), suspended_reason: r });
  }

  async function doUnsuspend() {
    if (!sel || busy) return;
    setBusy(true);
    const ok = await unsuspendUser(sel.id);
    setBusy(false);
    if (!ok) { toast.show('해제하지 못했어요', 'error'); return; }
    toast.show('정지를 해제했어요', 'success');
    await refreshSel({ suspended_at: null, suspended_reason: null });
  }

  const title = sel ? `${sel.name} (${ROLE[sel.role] || sel.role})` : '회원·파트너 찾기';
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {!sel ? (
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="이름 또는 전화번호 뒷자리 4자리" placeholderTextColor="#BAB7C0" autoFocus accessibilityLabel="찾을 이름이나 번호" />
          {searching ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 16 }} /> : list === null ? (
            <Text style={s.hint}>두 글자 이상 넣으면 찾아요. 번호는 뒷자리 4자리만 넣어도 돼요</Text>
          ) : list.length === 0 ? (
            <Text style={s.hint}>찾는 사람이 없어요</Text>
          ) : (
            <View style={s.list}>
              {list.map((u) => {
                const st = stateOf(u);
                return (
                  <TouchableOpacity key={u.id} style={s.item} onPress={() => openUser(u)} accessibilityLabel={`${u.name} 보기`}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemT}>{u.name} <Text style={s.itemRole}>{ROLE[u.role] || u.role}</Text></Text>
                      <Text style={s.itemSub}>{[u.withdrawn_at ? null : u.phone, u.gender === 'M' ? '남' : u.gender === 'F' ? '여' : null, u.age ? `${u.age}세` : null, u.location].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {st && <Text style={[s.badge, { color: st.color, borderColor: st.color }]}>{st.label}</Text>}
                    <Text style={s.arrow}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      ) : (
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <TouchableOpacity onPress={() => setSel(null)} accessibilityLabel="찾기 목록으로" hitSlop={8}>
            <Text style={s.back}>‹ 목록으로</Text>
          </TouchableOpacity>
          <View style={s.box}>
            <Line k="전화번호" v={sel.withdrawn_at ? '(탈퇴로 지움)' : sel.phone} />
            <Line k="가입일" v={day(sel.created_at)} />
            {!!sel.withdrawn_at && <Line k="탈퇴일" v={day(sel.withdrawn_at)} />}
            {!!sel.suspended_at && <Line k="정지" v={`${day(sel.suspended_at)} · ${sel.suspended_reason || '사유 없음'}`} red />}
          </View>
          {!sum ? <ActivityIndicator color="#5B21FF" style={{ marginVertical: 12 }} /> : (
            <View style={s.box}>
              {sum.partner ? (
                <>
                  <Line k="상호" v={sum.partner.businessName || '-'} />
                  <Line k="파트너 상태" v={PARTNER_STATUS[sum.partner.status] || sum.partner.status || '-'} />
                  <Line k="1회 비용" v={sum.partner.fee ? `${sum.partner.fee.toLocaleString()}원` : '-'} />
                  <Line k="회원" v={`${sum.partner.members}명${sum.partner.pendingMembers ? ` · 가입 대기 ${sum.partner.pendingMembers}명` : ''}`} />
                  {sum.partner.pendingWithdrawals > 0 && <Line k="출금 요청" v={`${sum.partner.pendingWithdrawals}건 대기`} />}
                </>
              ) : (
                <>
                  <Line k="가입한 파트너" v={sum.partners.length ? sum.partners.map((p) => `${p.name}(${REQ[p.status] || p.status})`).join(', ') : '없음'} />
                  <Line k="남은 이용권" v={`${sum.creditsLeft}회`} />
                </>
              )}
              <Line k="매칭" v={`진행 중 ${sum.activeMatches}건 · 끝남 ${sum.doneMatches}건`} />
              <Line k="받은 신고" v={sum.reportsAgainst ? `${sum.reportsAgainst}건${sum.openReportsAgainst ? ` (처리 전 ${sum.openReportsAgainst}건)` : ''}` : '없음'} red={sum.openReportsAgainst > 0} />
              <Line k="한 신고" v={sum.reportsMade ? `${sum.reportsMade}건` : '없음'} />
            </View>
          )}

          {!sel.withdrawn_at && (
            <TouchableOpacity style={s.primary} onPress={() => { onClose(); router.push({ pathname: '/chat', params: { with: sel.id, name: sel.name } }); }} accessibilityLabel={`${sel.name}님과 대화하기`}>
              <Text style={s.primaryT}>💬 대화하기</Text>
            </TouchableOpacity>
          )}
          {!sel.withdrawn_at && (sel.suspended_at ? (
            <TouchableOpacity style={s.ghost} onPress={doUnsuspend} disabled={busy} accessibilityLabel="정지 해제">
              {busy ? <ActivityIndicator color="#65626B" /> : <Text style={s.ghostT}>정지 해제</Text>}
            </TouchableOpacity>
          ) : suspending ? (
            <View style={s.suspendBox}>
              <Text style={s.suspendT}>정지하면 로그인할 수 없고, 만나기 전 소개는 끝나요. 나중에 해제할 수 있어요</Text>
              <TextInput style={s.input} value={reason} onChangeText={setReason} placeholder="정지 사유 (예: 반복 노쇼)" placeholderTextColor="#BAB7C0" accessibilityLabel="정지 사유" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.ghost, { flex: 1 }]} onPress={() => setSuspending(false)} accessibilityLabel="정지 취소"><Text style={s.ghostT}>취소</Text></TouchableOpacity>
                <TouchableOpacity style={[s.danger, { flex: 2 }]} onPress={doSuspend} disabled={busy} accessibilityLabel="정지하기">
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.dangerT}>정지하기</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setSuspending(true)} accessibilityLabel="이용 정지" hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
              <Text style={s.dangerLink}>이용 정지</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

function Line({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <View style={s.line}>
      <Text style={s.lineK}>{k}</Text>
      <Text style={[s.lineV, red && { color: '#E5484D' }]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#E4E1EA', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff' },
  rowT: { fontSize: 15, fontWeight: '700', color: '#322F38' },
  rowSub: { fontSize: 13, color: '#87848D' },
  input: { borderWidth: 1, borderColor: '#DCD9E2', borderRadius: 10, paddingHorizontal: 12, height: 46, fontSize: 15, color: '#322F38', backgroundColor: '#fff' },
  hint: { fontSize: 13, color: '#98959E', textAlign: 'center', marginVertical: 12 },
  list: { borderWidth: 1, borderColor: '#EFEDF2', borderRadius: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F1F6' },
  itemT: { fontSize: 15, fontWeight: '700', color: '#322F38' },
  itemRole: { fontSize: 12, fontWeight: '500', color: '#87848D' },
  itemSub: { fontSize: 12, color: '#87848D', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  arrow: { fontSize: 18, color: '#DCD9E2' },
  back: { fontSize: 14, color: '#5B21FF', fontWeight: '600' },
  box: { backgroundColor: '#F8F7FA', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  lineK: { fontSize: 13, color: '#87848D' },
  lineV: { flex: 1, textAlign: 'right', fontSize: 14, color: '#322F38', fontWeight: '600' },
  primary: { height: 50, borderRadius: 12, backgroundColor: '#5B21FF', alignItems: 'center', justifyContent: 'center' },
  primaryT: { fontSize: 15, fontWeight: '700', color: '#fff' },
  ghost: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#DCD9E2', alignItems: 'center', justifyContent: 'center' },
  ghostT: { fontSize: 14, fontWeight: '600', color: '#54515A' },
  dangerLink: { fontSize: 13, color: '#E5484D', textDecorationLine: 'underline' },
  suspendBox: { gap: 10, borderWidth: 1, borderColor: '#F5C2C4', backgroundColor: '#FFF6F6', borderRadius: 14, padding: 12 },
  suspendT: { fontSize: 13, color: '#54515A', lineHeight: 19 },
  danger: { height: 46, borderRadius: 12, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
  dangerT: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
