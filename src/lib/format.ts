const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 만남 날짜 표시: "10월 15일 (수)" (시간·장소는 회원끼리 연락해 정한다)
export function formatMeetingDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

// 연결자 주요 지역은 '["서울","경기"]' 형태의 JSON 문자열로 저장된다 → "서울, 경기"
export function formatRegions(value?: string | null) {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
  } catch {
    return value;
  }
}
