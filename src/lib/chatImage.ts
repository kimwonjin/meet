// 채팅 사진: 메시지 내용을 '📷 사진\n주소'로 저장한다 (칸을 새로 만들지 않아 SQL 없이 동작)
// 목록 미리보기·휴대폰 알림에서는 '📷 사진'만 보인다
export const IMAGE_PREFIX = '📷 사진\n';

export const makeImageContent = (url: string) => `${IMAGE_PREFIX}${url}`;

export function parseImage(content?: string | null): string | null {
  if (!content || !content.startsWith(IMAGE_PREFIX)) return null;
  const url = content.slice(IMAGE_PREFIX.length).trim();
  // 앱 사진 저장소 주소만 사진으로 보여 준다 (글로 '📷 사진' + 다른 주소를 써도 사진으로 보이지 않게)
  return /^https:\/\/\S+\/storage\/v1\/object\/public\/\S+$/.test(url) ? url : null;
}

export const previewText = (content?: string | null) => (parseImage(content) ? '📷 사진' : content || '');
