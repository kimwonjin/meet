// 사업자 정보 (전자상거래법상 통신판매업자 표시 사항). 사업자등록·통신판매업 신고 후 값을 채운다.
// 값이 비어 있으면 화면 하단 사업자 정보는 보이지 않고, 약관에는 [ ] 자리표시가 남는다.
export const BUSINESS = {
  companyName: '', // 상호 (예: 두두인연)
  ceo: '', // 대표자
  bizNumber: '', // 사업자등록번호 (예: 123-45-67890)
  mailOrderNumber: '', // 통신판매업 신고번호 (예: 제2026-서울강남-0000호)
  address: '', // 사업장 주소
  phone: '', // 고객센터 전화
  email: '', // 고객센터 이메일
  privacyOfficer: '', // 개인정보 보호책임자 이름
  privacyContact: '', // 개인정보 보호책임자 연락처 (이메일/전화)
};

// 법에서 표시하라고 정한 항목이 모두 채워졌는지
export function businessInfoReady() {
  const b = BUSINESS;
  return !!(b.companyName && b.ceo && b.bizNumber && b.mailOrderNumber && b.address && (b.phone || b.email));
}

// 약관 문장에 넣을 값: 비어 있으면 [ ] 자리표시
export const biz = (value: string, placeholder: string) => value || `[${placeholder}]`;
