// 1회 비용 표시: null/빈 값 = 아직 안 정함, 0 = 무료로 소개하는 파트너
export const isFreeFee = (fee: any) => fee !== null && fee !== undefined && fee !== '' && Number(fee) === 0;
export const hasFee = (fee: any) => isFreeFee(fee) || Number(fee) > 0;
// '무료' · '50,000원' · null(안 정함)
export function feeText(fee: any): string | null {
  if (isFreeFee(fee)) return '무료';
  return Number(fee) > 0 ? `${Number(fee).toLocaleString()}원` : null;
}
