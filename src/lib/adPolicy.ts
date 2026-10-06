// 결혼중개업법상 거짓·과장 광고가 될 수 있는 표현. 띄어쓰기를 무시하고 찾는다.
// DB의 fn_banned_ad_word 와 같은 목록 (supabase/migrations/add_ads_kit.sql)
export const BANNED_AD_WORDS = ['성혼율', '성혼률', '성공률', '100%', '100프로', '백퍼', '보장', '확실', '무조건', '1위', '업계최초', '유일한', '완벽한', '결혼성공'];

export function findBannedWord(...texts: (string | undefined | null)[]): string | null {
  const t = texts.filter(Boolean).join(' ').replace(/\s/g, '').toLowerCase();
  return BANNED_AD_WORDS.find((w) => t.includes(w)) ?? null;
}
