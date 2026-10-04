import { supabase } from './supabase';
import { createNotification } from './notifications';

// 만남 완료 후 이 기간 안에 애프터 의사를 고르지 않으면 '미신청'으로 처리하고 정산한다
export const AFTER_CARE_DAYS = 7;

export function afterCareDeadline(meetingCompletedAt: string) {
  const d = new Date(meetingCompletedAt);
  d.setDate(d.getDate() + AFTER_CARE_DAYS);
  return d;
}

export function formatDeadline(d: Date) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

type AfterCareMatch = {
  id: string;
  status?: string;
  meeting_status?: string;
  meeting_completed_at?: string | null;
  settlement_completed?: boolean;
  after_care_hopeful_1?: string | null;
  after_care_hopeful_2?: string | null;
};

// 기한이 지난 매칭은 응답하지 않은 쪽을 '미신청'으로 채우고 정산한다.
// 별도 서버 작업 없이, 회원이나 파트너가 화면을 열 때 처리된다. 처리한 경우 true.
export async function expireAfterCareIfDue(m: AfterCareMatch) {
  // 취소된 매칭은 마무리(정산)하지 않는다
  if (m.status === 'rejected' || m.meeting_status !== 'completed' || m.settlement_completed) return false;

  // 두 회원이 모두 골랐는데 마무리가 안 된 경우 (네트워크 오류 등) 다시 시도한다
  if (m.after_care_hopeful_1 && m.after_care_hopeful_2) {
    const { data: settledNow, error } = await supabase.rpc('fn_settle_match', { p_match_id: m.id });
    if (error) {
      console.error('after-care settle retry error:', error);
      return false;
    }
    if (settledNow) await notifyAfterCareResult(m.id);
    return !!settledNow;
  }

  if (!m.meeting_completed_at) return false;
  if (Date.now() < afterCareDeadline(m.meeting_completed_at).getTime()) return false;

  if (!m.after_care_hopeful_1) {
    await supabase.from('match_requests').update({ after_care_hopeful_1: '미신청' }).eq('id', m.id).is('after_care_hopeful_1', null);
  }
  if (!m.after_care_hopeful_2) {
    await supabase.from('match_requests').update({ after_care_hopeful_2: '미신청' }).eq('id', m.id).is('after_care_hopeful_2', null);
  }
  // 여러 화면이 동시에 처리해도 실제로 마무리한 한 곳만 결과를 알린다
  const { data: settledNow, error } = await supabase.rpc('fn_settle_match', { p_match_id: m.id });
  if (error) console.error('after-care auto close error:', error);
  else if (settledNow) await notifyAfterCareResult(m.id);
  return true;
}

// 두 회원의 애프터 의사가 모두 모인 뒤에만 결과를 알린다 (먼저 고른 사람이 상대 선택을 보고 정하지 못하게).
// 회원에게는 '둘 다 원함' 또는 '마무리'만 알리고, 누가 원하지 않았는지는 알리지 않는다.
// exceptUserId: 방금 화면에서 결과를 확인한 회원 (알림 생략)
export async function notifyAfterCareResult(matchId: string, exceptUserId?: string) {
  const { data: m } = await supabase.from('match_requests').select('*').eq('id', matchId).single();
  if (!m || !m.after_care_hopeful_1 || !m.after_care_hopeful_2 || m.closed_reason === 'no_show') return;
  const mutual = m.after_care_hopeful_1 === '신청' && m.after_care_hopeful_2 === '신청';

  const members = [m.hopeful_1_id, m.hopeful_2_id].filter((id: string) => id !== exceptUserId);
  const connectors = [...new Set<string>([m.connector_1_id, m.connector_2_id])];
  await Promise.all([
    ...members.map((id: string) => createNotification({
      userId: id,
      type: 'after_care_result',
      title: mutual ? '💞 상대도 다시 만나고 싶어해요' : '소개팅 결과가 도착했어요',
      body: mutual ? '채팅에서 받은 연락처로 다시 연락해보세요' : '이번 만남은 여기서 마무리되었어요',
      route: '/home',
    })),
    ...(mutual ? connectors.map((id) => createNotification({
      userId: id,
      type: 'after_care_mutual',
      title: '💞 두 회원 모두 다시 만나고 싶어해요',
      body: '소개한 두 회원이 모두 애프터를 원했습니다',
      route: '/matching',
      routeParams: connectors.length > 1 ? { segment: 'ally' } : undefined,
    })) : []),
  ]);
}
