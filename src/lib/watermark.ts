// 사진 워터마크에 넣는 '보는 사람 번호'. 전화번호 대신 회원 고유번호 앞 8자리를 쓴다.
// 캡처가 퍼져도 보는 사람의 개인정보는 드러나지 않고, 운영자만 누구인지 찾을 수 있다 (설정 › 워터마크 번호로 회원 찾기).
export function viewerCode(userId?: string | null) {
  return (userId || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

// 좁은 사진에도 들어가도록 두 줄: 보는 사람 번호 / 날짜·시각
export function watermarkLines(userId?: string | null, now = new Date()): [string, string] {
  const p = (n: number) => String(n).padStart(2, '0');
  return [`두두인연 ${viewerCode(userId) || '비회원'}`, `${p(now.getMonth() + 1)}/${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`];
}
