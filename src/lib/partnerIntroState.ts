// 파트너 소개(경력·소개 글·1회 비용)를 한 칸이라도 저장했는지 (심사 대기 중인 수정본 포함)
// 안 썼으면 초대장보다 소개 쓰기를 먼저 보여 준다
export function isPartnerIntroWritten(c: any): boolean {
  if (!c) return false;
  const pend = c.pending_profile && typeof c.pending_profile === 'object' ? Object.values(c.pending_profile).some((v: any) => String(v ?? '').trim()) : false;
  return !!(String(c.career || '').trim() || String(c.intro || '').trim() || Number(c.fee_per_session) > 0 || pend);
}
