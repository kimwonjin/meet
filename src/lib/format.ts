const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 만남 날짜 표시: "10월 15일 (수)" (시간·장소는 회원끼리 연락해 정한다)
export function formatMeetingDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
