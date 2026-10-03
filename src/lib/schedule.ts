import { supabase } from './supabase';
import { createNotification } from './notifications';
import { formatMeetingDate } from './format';

// 일정은 날짜만 정한다. 시간대 차이로 날짜가 밀리지 않도록 그날 정오로 저장한다.
export function dateKeyToMeetingAt(dateKey: string) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(y, mo - 1, d, 12, 0).toISOString();
}

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

  const at = dateKeyToMeetingAt(common);
  const { error } = await supabase
    .from('match_requests')
    .update({ meeting_scheduled_at: at })
    .eq('id', matchId)
    .is('meeting_scheduled_at', null);
  if (error) throw error;

  const when = formatMeetingDate(at);
  await Promise.all([
    ...memberIds.map((id) =>
      createNotification({ userId: id, type: 'meeting_scheduled', title: `소개팅 날짜가 정해졌어요 · ${when}`, body: '상대 연락처가 공개됐어요. 시간과 장소는 서로 연락해 정해주세요', route: '/home' })
    ),
    ...connectorIds.map((id) =>
      createNotification({ userId: id, type: 'meeting_scheduled', title: '두 회원의 날짜가 맞춰졌어요', body: when, route: '/matching' })
    ),
  ]);
  return { status: 'scheduled', at };
}
