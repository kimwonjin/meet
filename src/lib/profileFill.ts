// 회원 프로필 채운 정도: 마이 '내 프로필 수정'의 막대와 홈 '프로필 채우기 도우미'가 같이 쓴다
// 홈에는 빠진 것 중 가장 효과가 큰 하나만 안내한다 (순서 = 중요한 순)
export type FillInput = {
  photo_urls?: (string | null)[] | null; location?: string | null; height?: number | string | null; job?: string | null;
  education?: string | null; bio?: string | null; religion?: string | null; smoking?: string | null; drinking?: string | null;
  body_type?: string | null; job_category?: string | null;
};

const HINT: Record<string, string> = {
  사진: '사진을 올리면 소개받기 훨씬 쉬워요',
  자기소개: '자기소개 한두 줄이면 첫인상이 좋아져요',
  직업: '직업을 적으면 파트너가 맞는 분을 찾기 쉬워요',
  지역: '지역을 정하면 가까운 분을 소개받아요',
  키: '키를 적으면 원하는 조건에 맞춰 소개받기 쉬워요',
  학력: '학력을 적으면 소개 폭이 넓어져요',
  '직업 분류': '직업 분류를 고르면 파트너가 찾기 쉬워요',
  '흡연·음주': '흡연·음주를 적으면 잘 맞는 분을 찾기 쉬워요',
  종교: '종교를 적으면 잘 맞는 분을 찾기 쉬워요',
  체형: '체형을 적으면 프로필이 더 또렷해져요',
};

export function profileFill(p: FillInput, withJobCategory = false) {
  const photos = (p.photo_urls ?? []).filter(Boolean).length;
  const items: [string, boolean][] = [
    ['사진', photos > 0], ['자기소개', !!p.bio?.trim()], ['직업', !!p.job?.trim()], ['지역', !!p.location], ['키', !!p.height],
    ['학력', !!p.education], ...(withJobCategory ? ([['직업 분류', !!p.job_category]] as [string, boolean][]) : []),
    ['흡연·음주', !!p.smoking && !!p.drinking], ['종교', !!p.religion], ['체형', !!p.body_type],
  ];
  const done = items.filter(([, v]) => v).length;
  const pct = Math.round((done / items.length) * 100);
  const missing = items.filter(([, v]) => !v).map(([k]) => k);
  // 다음에 채울 것 하나 (사진이 1장뿐이면 다 채웠어도 한 장 더 권한다)
  const next = missing[0] ? { key: missing[0], hint: HINT[missing[0]] } : photos === 1 ? { key: '사진', hint: '사진 1장 더 올리면 소개받기 쉬워요' } : null;
  return { pct, missing, next, photos };
}

export const FILL_NUDGE_BELOW = 70;
