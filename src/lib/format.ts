const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 만남 일정 표시: "10월 15일 (수) 19:00"
export function formatMeetingTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) ${hh}:${mm}`;
}
