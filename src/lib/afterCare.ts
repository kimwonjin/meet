import { supabase } from './supabase';

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
  meeting_status?: string;
  meeting_completed_at?: string | null;
  settlement_completed?: boolean;
  after_care_hopeful_1?: string | null;
  after_care_hopeful_2?: string | null;
};

// 기한이 지난 매칭은 응답하지 않은 쪽을 '미신청'으로 채우고 정산한다.
// 별도 서버 작업 없이, 회원이나 파트너가 화면을 열 때 처리된다. 처리한 경우 true.
export async function expireAfterCareIfDue(m: AfterCareMatch) {
  if (m.meeting_status !== 'completed' || m.settlement_completed || !m.meeting_completed_at) return false;
  if (Date.now() < afterCareDeadline(m.meeting_completed_at).getTime()) return false;
  if (m.after_care_hopeful_1 && m.after_care_hopeful_2) return false;

  if (!m.after_care_hopeful_1) {
    await supabase.from('match_requests').update({ after_care_hopeful_1: '미신청' }).eq('id', m.id).is('after_care_hopeful_1', null);
  }
  if (!m.after_care_hopeful_2) {
    await supabase.from('match_requests').update({ after_care_hopeful_2: '미신청' }).eq('id', m.id).is('after_care_hopeful_2', null);
  }
  const { error } = await supabase.rpc('fn_settle_match', { p_match_id: m.id });
  if (error) console.error('after-care auto close error:', error);
  return true;
}
