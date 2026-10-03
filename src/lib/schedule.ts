import { supabase } from './supabase';
import { createNotification } from './notifications';
import { formatMeetingTime } from './format';

// 두 회원이 고른 날짜가 겹치면 자동으로 잡는 만남 시각
export const DEFAULT_MEETING_HOUR = 19;

export function earliestCommonDate(a: string[] | null, b: string[] | null): string | null {
  if (!a?.length || !b?.length) return null;
  const setB = new Set(b);
  return [...a].sort().find((d) => setB.has(d)) ?? null;
}

type AutoScheduleResult = { status: 'waiting' } | { status: 'scheduled'; at: string } | { status: 'no_overlap' } | { status: 'already' };

// 두 회원이 모두 승인하고 날짜를 골랐으면 겹치는 가장 빠른 날로 일정을 정하고 관련자에게 알린다.
// 저장된 최신 값으로 판단한다 (두 회원이 다른 기기에서 시차를 두고 승인하기 때문).
export async function autoScheduleMatch(matchId: string): Promise<AutoScheduleResult> {
  const { data: m } = await supabase.from('match_requests').select('*').eq('id', matchId).single();
  if (!m || !m.hopeful_1_approved || !m.hopeful_2_approved) return { status: 'waiting' };
  if (m.meeting_scheduled_at) return { status: 'already' };
  if (!m.available_dates_1?.length || !m.available_dates_2?.length) return { status: 'waiting' };

  const connectorIds = [...new Set([m.connector_1_id, m.connector_2_id].filter(Boolean))] as string[];
  const memberIds = [m.hopeful_1_id, m.hopeful_2_id];

  const common = earliestCommonDate(m.available_dates_1, m.available_dates_2);
  if (!common) {
    await Promise.all([
      ...memberIds.map((id) =>
        createNotification({ userId: id, type: 'schedule_no_overlap', title: '가능한 날짜가 겹치지 않아요', body: '홈에서 날짜를 다시 골라주세요', route: '/home' })
      ),
      ...connectorIds.map((id) =>
        createNotification({ userId: id, type: 'schedule_no_overlap', title: '회원들의 가능한 날짜가 겹치지 않아요', body: '회원이 날짜를 다시 고르거나 직접 일정을 정할 수 있어요', route: '/matching' })
      ),
    ]);
    return { status: 'no_overlap' };
  }

  const [y, mo, d] = common.split('-').map(Number);
  const at = new Date(y, mo - 1, d, DEFAULT_MEETING_HOUR, 0).toISOString();
  const { error } = await supabase
    .from('match_requests')
    .update({ meeting_scheduled_at: at })
    .eq('id', matchId)
    .is('meeting_scheduled_at', null);
  if (error) throw error;

  const when = formatMeetingTime(at);
  await Promise.all([
    ...memberIds.map((id) =>
      createNotification({ userId: id, type: 'meeting_scheduled', title: '소개팅 일정이 정해졌어요', body: when, route: '/home' })
    ),
    ...connectorIds.map((id) =>
      createNotification({ userId: id, type: 'meeting_scheduled', title: '두 회원의 일정이 맞춰졌어요', body: when, route: '/matching' })
    ),
  ]);
  return { status: 'scheduled', at };
}
