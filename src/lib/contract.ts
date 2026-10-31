// 결혼중개계약서 (결혼중개업법 제10조): 회원이 이용권을 처음 살 때 전자문서로 내주고, 마이에서 언제든 다시 본다
// 기재사항 ② 1~5호: 수수료, 해지·반환, 배상책임, 서비스 내용·방법·기간, 그 밖의 준수사항
// 동의 기록은 user_consents(doc='contract')에 남긴다 (계약서는 5년 보존: 시행규칙 제9조)
import { supabase } from './supabase';
import { BUSINESS, biz } from './business';
import { TERMS_VERSION } from './terms';

export type ContractInfo = { partnerName?: string; fee?: number; count?: number };

export async function hasContract(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('user_consents').select('doc').eq('user_id', userId).eq('doc', 'contract').limit(1);
  if (error) return false;
  return (data || []).length > 0;
}

export function contractSections(c: ContractInfo): { heading: string; body: string }[] {
  const b = BUSINESS;
  const money = c.fee && c.count
    ? `· 담당 파트너: ${c.partnerName || '파트너'}\n· 소개 1회 비용: ${c.fee.toLocaleString()}원\n· 이번 구매: ${c.count}회 · 합계 ${(c.fee * c.count).toLocaleString()}원`
    : '· 소개 1회 비용은 담당 파트너마다 다르며, 서비스 화면의 요금표와 구매 화면에 표시된 금액을 따릅니다.';
  return [
    {
      heading: '계약 당사자',
      body: `· 결혼중개업자: ${biz(b.companyName, '회사명')} (대표 ${biz(b.ceo, '대표자')}, 국내결혼중개업 신고 ${biz(b.reportNumber, '신고번호')}, ${biz(b.address, '주소')}, ${biz([b.phone, b.email].filter(Boolean).join(' · '), '연락처')})
· 이용자: 이 계약서에 동의한 회원 본인
소개는 회사가 업무를 맡긴 담당 파트너(커플매니저)가 수행하며, 계약 상대는 회사입니다.`,
    },
    {
      heading: '1. 수수료·회비',
      body: `${money}
· 가입비·월회비는 없습니다. 이용권 외에 따로 받는 돈은 없습니다.
· 이용권은 만남이 정상적으로 마무리될 때 1회씩 차감됩니다. 노쇼·매칭 취소·거절은 차감하지 않습니다.`,
    },
    {
      heading: '2. 해지와 반환',
      body: `· 회원은 언제든 계약을 해지(탈퇴 또는 환불 요청)할 수 있습니다.
· 결제 후 7일 안에 이용권을 하나도 쓰지 않았으면 전액 돌려드립니다.
· 그 밖에는 쓰지 않은 이용권과 충전 잔액을 수수료 없이 돌려드리고, 이미 정상 마무리된 이용권은 돌려드리지 않습니다.
· 회사(회사가 업무를 맡긴 파트너 포함)의 잘못으로 소개를 받지 못하면 기간과 관계없이 전액 돌려드립니다.
· 환불은 요청일로부터 영업일 3일 안에 처리합니다.`,
    },
    {
      heading: '3. 배상책임',
      body: `· 회사는 결혼중개와 관련하여 회사 또는 담당 파트너의 잘못으로 회원에게 생긴 손해를 관련 법령에 따라 배상합니다.
· 회사는 이를 위해 「결혼중개업의 관리에 관한 법률」 제25조에 따른 보증보험에 가입하며, 회사가 배상하지 않으면 회원은 보증보험금을 청구할 수 있습니다.
· 회원끼리 직접 만나는 과정에서 생긴 일에 대해서는 회사의 고의·과실이 없으면 책임지지 않습니다.`,
    },
    {
      heading: '4. 서비스 내용·방법·기간',
      body: `· 내용: 담당 파트너가 회원의 프로필과 원하는 조건을 보고 어울리는 상대를 골라 만남을 제안하고, 일정 조율·연락처 전달·만남 후 의사 확인까지 진행합니다.
· 방법: 앱 안에서 제안·승인·날짜 선택·채팅으로 진행하며, 만남 날짜가 정해지면 상대 연락처를 담당 파트너 채팅으로 전달합니다.
· 기간·시기: 이용권은 유효기간이 없으며, 소개 시기는 담당 파트너와 상대 회원의 사정에 따라 달라집니다. 회원은 '소개 잠시 쉬기'로 언제든 소개를 멈출 수 있습니다.
· 회사는 만남의 성사나 결과를 보증하지 않습니다.`,
    },
    {
      heading: '5. 그 밖의 준수사항',
      body: `· 회사는 거짓·과장된 정보를 제공하지 않고, 회원의 개인정보를 결혼중개 외의 용도로 쓰거나 다른 사람에게 제공하지 않습니다.
· 회원은 사실대로 프로필을 입력하고, 만남 날짜가 정해지기 전에는 연락처를 주고받지 않습니다.
· 이 계약서에 없는 내용은 서비스 이용약관(${TERMS_VERSION})과 관련 법령을 따릅니다.
· 계약서는 서비스의 마이 › 이용권/결제에서 언제든 다시 볼 수 있으며, 회사는 이를 5년간 보존합니다.`,
    },
  ];
}
