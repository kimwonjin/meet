// 채팅 '자주 쓰는 문구' (이 기기에 저장). 처음에는 역할별 기본 문구를 넣어 두고, 고치거나 빼거나 더할 수 있다
// 파트너: 안내 문구 · 회원: 짧은 답장
import AsyncStorage from '@react-native-async-storage/async-storage';

// 운영자와의 대화는 문의용 문구를 따로 둔다
export type PhraseKind = 'normal' | 'operator';
const key = (userId: string, kind: PhraseKind = 'normal') => `dudu_quick_phrases_${userId}${kind === 'operator' ? '_op' : ''}`;
export const MAX_PHRASES = 20;

export const defaultPhrases = (name: string) => [
  `안녕하세요! 담당 파트너 ${name}입니다 😊`,
  '새 소개를 보내드렸어요. 홈에서 프로필을 확인하고 답해 주세요',
  '만남 날짜가 정해졌어요. 상대 연락처를 보내드렸으니 시간과 장소를 정해 주세요',
  '만남은 어떠셨어요? 홈에서 다음 만남 의사를 알려 주세요',
  '궁금한 점 있으시면 편하게 말씀해 주세요',
];

// 회원 빠른 답장
export const memberPhrases = () => [
  '네, 좋아요 😊',
  '확인했어요. 감사합니다!',
  '일정이 있어서 날짜 조율 부탁드려요',
  '상대분께 먼저 연락드릴게요',
  '만남 잘 다녀왔어요. 감사합니다 🙏',
  '조금 더 생각해 보고 답드릴게요',
];

// 운영자에게 보내는 문의용 답장
export const operatorPhrases = () => [
  '문의드릴 게 있어요',
  '확인 부탁드려요',
  '결제·환불 관련 문의예요',
  '불편한 일이 있어 알려드려요',
  '해결됐어요. 감사합니다!',
];

export async function loadPhrases(userId: string, name: string, isPartner = true, kind: PhraseKind = 'normal'): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(userId, kind));
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter((x) => typeof x === 'string'); }
  } catch { /* 처음이거나 읽지 못하면 기본 문구 */ }
  if (kind === 'operator') return operatorPhrases();
  return isPartner ? defaultPhrases(name) : memberPhrases();
}

export async function savePhrases(userId: string, list: string[], kind: PhraseKind = 'normal') {
  await AsyncStorage.setItem(key(userId, kind), JSON.stringify(list.slice(0, MAX_PHRASES))).catch(() => {});
}
