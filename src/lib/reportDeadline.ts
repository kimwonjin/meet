// 신고 처리 기한 (약관: 접수 후 24시간 안에 검토). 20시간이 지나면 '곧 기한'으로 강조한다
export const REPORT_DEADLINE_HOURS = 24;
export const REPORT_WARN_HOURS = 20;

export type DeadlineLevel = 'ok' | 'soon' | 'over';

export function reportDeadline(createdAt: string, now = Date.now()): { level: DeadlineLevel; label: string } {
  const hours = (now - new Date(createdAt).getTime()) / 3600000;
  const left = REPORT_DEADLINE_HOURS - hours;
  // 지난 시간은 내림, 남은 시간은 올림 (22시간 59분 남음 → '23시간 남음')
  const fmt = (h: number, round: (n: number) => number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}분` : `${round(h)}시간`);
  if (left <= 0) return { level: 'over', label: `${fmt(-left, Math.floor)} 지남` };
  return { level: hours >= REPORT_WARN_HOURS ? 'soon' : 'ok', label: `${fmt(left, Math.ceil)} 남음` };
}
