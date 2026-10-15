// 탈퇴 전후 정리
// - 탈퇴 전에: 지울 사진, 동맹 파트너, 이름이 들어간 알림을 받은 사람을 모아 둔다 (탈퇴하면 연결 정보가 지워지므로)
// - 탈퇴 후에: 사진 파일 삭제, 동맹 파트너에게 종료 알림, 남은 알림 속 이름을 '탈퇴회원'으로, 번호 흔적(해시) 남기기
// - 같은 번호로 다시 가입하면: 예전 계정에 걸려 있던 차단을 새 계정에 다시 걸고, 신고 이력이 있으면 운영자에게 알린다
// 모두 실패해도 탈퇴·가입 자체는 그대로 진행된다
import { supabase } from './supabase';
import { createNotification } from './notifications';
import { deletePhoto } from './photos';

// 번호는 그대로 남기지 않고 되돌릴 수 없는 값(SHA-256)으로만 남긴다
export async function phoneHash(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle || !digits) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(`dudu:${digits}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type WithdrawPrep = {
  userId: string;
  name: string;
  phone: string;
  role: string;
  photos: string[];
  allies: string[];
  related: string[];
};

export async function prepareWithdraw(user: { id: string; name: string; phone: string; role: string }): Promise<WithdrawPrep> {
  const [{ data: me }, { data: reqs }, { data: allianceRows }, { data: ms1 }, { data: ms2 }] = await Promise.all([
    supabase.from('users').select('photo_urls').eq('id', user.id).maybeSingle(),
    supabase.from('hopeful_requests').select('connector_id, hopeful_id').or(`hopeful_id.eq.${user.id},connector_id.eq.${user.id}`),
    supabase.from('connector_alliances').select('connector_1_id, connector_2_id').or(`connector_1_id.eq.${user.id},connector_2_id.eq.${user.id}`).eq('status', 'ACTIVE'),
    supabase.from('match_requests').select('connector_1_id, connector_2_id, hopeful_1_id, hopeful_2_id').eq('hopeful_1_id', user.id),
    supabase.from('match_requests').select('connector_1_id, connector_2_id, hopeful_1_id, hopeful_2_id').eq('hopeful_2_id', user.id),
  ]);
  const allies = (allianceRows || []).map((a: any) => (a.connector_1_id === user.id ? a.connector_2_id : a.connector_1_id));
  const related = new Set<string>(allies);
  for (const r of (reqs || []) as any[]) related.add(r.connector_id === user.id ? r.hopeful_id : r.connector_id);
  for (const m of [...(ms1 || []), ...(ms2 || [])] as any[]) for (const id of [m.connector_1_id, m.connector_2_id, m.hopeful_1_id, m.hopeful_2_id]) related.add(id);
  related.delete(user.id);
  return {
    userId: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    photos: ((me?.photo_urls as string[]) || []).filter(Boolean),
    allies,
    related: [...related].filter(Boolean),
  };
}

export async function afterWithdraw(p: WithdrawPrep) {
  const tasks: Promise<unknown>[] = [];
  // 1) 사진 파일 삭제 (프로필에서 빠져도 공개 주소로는 남아 있으므로)
  for (const url of p.photos) tasks.push(deletePhoto(url).catch(() => {}));
  // 2) 동맹 파트너에게 동맹 종료 알림
  for (const id of p.allies) {
    tasks.push(createNotification({ userId: id, type: 'alliance_ended', title: '동맹이 종료되었어요', body: '동맹 파트너가 탈퇴해 동맹이 끝났어요. 매칭 화면에서 진행 상황을 확인해 주세요', route: '/alliances' }).catch(() => {}));
  }
  // 3) 다른 사람이 받은 알림 속 내 이름을 '탈퇴회원'으로 (이름 뒤에 '님'이 붙은 경우만 바꿔 같은 글자의 다른 말은 건드리지 않는다)
  if (p.name && p.related.length) {
    tasks.push((async () => {
      const key = `${p.name}님`;
      const { data: rows } = await supabase
        .from('notifications')
        .select('id, title, body')
        .in('user_id', p.related)
        .or(`title.ilike.%${key}%,body.ilike.%${key}%`)
        .limit(300);
      // '민지'가 탈퇴해도 '김민지님'은 바꾸지 않도록, 이름 앞이 한글이 아닌 경우만 바꾼다
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = `(^|[^가-힣])${esc}님`;
      const has = (t: string | null) => !!t && new RegExp(pattern).test(t);
      const anon = (t: string | null) => (t ? t.replace(new RegExp(pattern, 'g'), '$1탈퇴회원님') : t);
      await Promise.all(((rows || []) as any[])
        .filter((n) => has(n.title) || has(n.body))
        .map((n) => supabase.from('notifications').update({ title: anon(n.title), body: anon(n.body) }).eq('id', n.id)));
    })().catch(() => {}));
  }
  // 4) 번호 흔적 남기기 (같은 번호로 다시 가입하면 예전 차단을 이어 붙이려고). 표가 없으면(DB 준비 전) 조용히 넘어간다
  tasks.push((async () => {
    const hash = await phoneHash(p.phone);
    if (hash) await supabase.from('withdrawn_identities').insert({ phone_hash: hash, user_id: p.userId });
  })().catch(() => {}));
  await Promise.all(tasks);
}

// 같은 번호로 다시 가입한 경우: 예전 계정의 차단을 새 계정에 다시 걸고, 신고 이력이 있으면 운영자에게 알린다
export async function linkPreviousAccount(newUserId: string, phone: string, name: string) {
  try {
    const hash = await phoneHash(phone);
    if (!hash) return;
    const { data: prev, error } = await supabase.from('withdrawn_identities').select('user_id').eq('phone_hash', hash);
    if (error || !prev?.length) return;
    const oldIds = prev.map((r: any) => r.user_id).filter((id: string) => id && id !== newUserId);
    if (!oldIds.length) return;
    const [{ data: blockedMe }, { data: iBlocked }, { data: reports }] = await Promise.all([
      supabase.from('user_blocks').select('blocker_id').in('blocked_id', oldIds),
      supabase.from('user_blocks').select('blocked_id').in('blocker_id', oldIds),
      supabase.from('user_reports').select('id').in('target_id', oldIds),
    ]);
    const rows = [
      ...((blockedMe || []) as any[]).map((b) => ({ blocker_id: b.blocker_id, blocked_id: newUserId })),
      ...((iBlocked || []) as any[]).map((b) => ({ blocker_id: newUserId, blocked_id: b.blocked_id })),
    ];
    for (const r of rows) await supabase.from('user_blocks').insert(r); // 이미 있으면(중복) 무시
    if (reports?.length) {
      const { data: ops } = await supabase.from('users').select('id').eq('role', 'operator');
      await Promise.all(((ops || []) as any[]).map((o) => createNotification({
        userId: o.id,
        type: 'rejoined_reported',
        title: '신고 이력이 있는 번호로 다시 가입했어요',
        body: `${name}님 · 예전 계정 신고 ${reports.length}건. 신고 탭에서 확인해 주세요`,
        route: '/settlements',
      }).catch(() => {})));
    }
  } catch {
    // 연결에 실패해도 가입은 그대로 진행
  }
}
