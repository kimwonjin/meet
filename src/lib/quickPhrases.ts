// 파트너 채팅 '자주 쓰는 문구' (이 기기에 저장). 처음에는 기본 문구를 넣어 두고, 고치거나 빼거나 더할 수 있다
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (userId: string) => `dudu_quick_phrases_${userId}`;
export const MAX_PHRASES = 20;

export const defaultPhrases = (name: string) => [
  `안녕하세요! 담당 파트너 ${name}입니다 😊`,
  '새 소개를 보내드렸어요. 홈에서 프로필을 확인하고 답해 주세요',
  '만남 날짜가 정해졌어요. 상대 연락처를 보내드렸으니 시간과 장소를 정해 주세요',
  '만남은 어떠셨어요? 홈에서 다음 만남 의사를 알려 주세요',
  '궁금한 점 있으시면 편하게 말씀해 주세요',
];

export async function loadPhrases(userId: string, name: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v)) return v.filter((x) => typeof x === 'string'); }
  } catch { /* 처음이거나 읽지 못하면 기본 문구 */ }
  return defaultPhrases(name);
}

export async function savePhrases(userId: string, list: string[]) {
  await AsyncStorage.setItem(key(userId), JSON.stringify(list.slice(0, MAX_PHRASES))).catch(() => {});
}
