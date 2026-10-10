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

// 파트너 소개: 예전 '서비스 설명' 칸을 '파트너 소개' 하나로 합쳤다.
// 예전 글이 남아 있으면 소개 뒤에 붙여 보여주고, 이미 소개에 들어 있으면 다시 붙이지 않는다.
export function partnerIntro(c?: { intro?: string | null; service_description?: string | null } | null) {
  const intro = (c?.intro || '').trim();
  const service = (c?.service_description || '').trim();
  if (!service || intro.includes(service)) return intro;
  return intro ? `${intro}\n\n${service}` : service;
}
// 합친 뒤 저장할 때 예전 '서비스 설명' 칸을 비우는 값 (빈 칸을 허용하지 않는 DB에서도 저장되도록 공백 한 칸)
export const CLEARED_SERVICE_DESCRIPTION = ' ';
