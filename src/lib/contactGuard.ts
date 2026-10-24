// 만남일 전 연락처 노출 막기 (약관 제10조 3호)
// 프로필은 소개받는 상대에게 보이므로, 전화번호·메신저·SNS·이메일·링크가 들어가면 저장하지 않는다.
// 연락처는 만남일이 정해지면 파트너 채팅으로 자동 전달된다.

const KOR_DIGITS: Record<string, string> = { 공: '0', 영: '0', 일: '1', 이: '2', 삼: '3', 사: '4', 오: '5', 육: '6', 륙: '6', 칠: '7', 팔: '8', 구: '9' };

export type ContactHit = 'phone' | 'messenger' | 'sns' | 'email' | 'link';

export const CONTACT_HIT_LABEL: Record<ContactHit, string> = {
  phone: '전화번호',
  messenger: '카톡·메신저 아이디',
  sns: 'SNS 아이디',
  email: '이메일',
  link: '인터넷 주소',
};

// 아이디를 알려 주는 말 (뒤에 영문 아이디가 오거나 '아이디·추가·검색' 등이 붙을 때만)
const HANDLE = '((\\s*[:：]\\s*|\\s+)@?[a-z][a-z0-9._]{2,}|\\s*(아이디|id\\b|추가|검색|디엠|dm\\b|팔로우|친추|ㄱ))';
const MESSENGER = new RegExp(`(카톡|카카오톡|카카오\\s*아이디|kakao\\s*(talk|id)|katalk|라인|line|텔레그램|telegram|위챗|wechat)${HANDLE}`);
const SNS = new RegExp(`(인스타그램|인스타|instagram|insta|페북|페이스북|facebook|트위터|twitter|틱톡|tiktok|스레드|threads)${HANDLE}`);

function hasPhone(t: string) {
  // 숫자 사이에 띄어쓰기·하이픈·점이 있어도 찾는다
  if (/01[016789]\d{7,8}/.test(t.replace(/[\s\-.·_/()]/g, ''))) return true;
  // '공일공 일이삼사…'처럼 한글로 쓴 번호: 숫자 글자만으로 이어진 덩어리에서만 찾는다 (보통 문장 오인 방지)
  for (const run of t.match(/[공영일이삼사오육륙칠팔구0-9][공영일이삼사오육륙칠팔구0-9\s\-.]{8,}/g) || []) {
    const d = run.replace(/[\s\-.]/g, '').replace(/[^0-9]/g, (c) => KOR_DIGITS[c] || '');
    if (/^0?1[016789]\d{7,8}$/.test(d) || /01[016789]\d{7,8}/.test(d)) return true;
  }
  return false;
}

// strict=false(회사·직업 칸)면 번호·이메일·링크만 본다 ('카카오' 같은 회사 이름 오인 방지)
export function findContact(text: string | null | undefined, strict = true): ContactHit | null {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;
  if (hasPhone(t)) return 'phone';
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/.test(t)) return 'email';
  if (/(https?:\/\/|www\.|open\.kakao|[a-z0-9-]\.(com|kr|net|me|io|co)\b)/.test(t)) return 'link';
  if (!strict) return null;
  if (MESSENGER.test(t)) return 'messenger';
  if (SNS.test(t)) return 'sns';
  if (/(^|\s)@[a-z0-9._]{3,}/.test(t)) return 'sns';
  return null;
}

// 여러 칸 중 처음 걸린 칸과 종류. loose에 든 칸은 번호·이메일·링크만 본다
export function findContactIn(fields: Record<string, string | null | undefined>, loose: string[] = []): { field: string; hit: ContactHit } | null {
  for (const [field, v] of Object.entries(fields)) {
    const hit = findContact(v, !loose.includes(field));
    if (hit) return { field, hit };
  }
  return null;
}
