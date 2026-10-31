// 파트너 업무위탁 수수료의 원천징수 (사업소득 3.3% = 소득세 3% + 지방소득세 0.3%) — [세무사 확인 후 확정]
// 출금할 때 떼고 입금한다. 소득세가 1,000원 미만이면 떼지 않는다(소액부징수). 10원 미만은 버린다
export const WITHHOLDING_LABEL = '원천징수 3.3%';

export function withholding(amount: number) {
  const gross = Math.max(0, Math.floor(amount || 0));
  let income = Math.floor((gross * 0.03) / 10) * 10;
  if (income < 1000) income = 0;
  const local = Math.floor((income * 0.1) / 10) * 10;
  return { gross, income, local, tax: income + local, net: gross - income - local };
}
