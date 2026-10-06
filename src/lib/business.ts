import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// 사업자 정보 (전자상거래법상 통신판매업자 표시 사항 + 국내결혼중개업 신고번호).
// 운영자가 앱 안 '설정 › 사업자 정보'에서 입력하면 platform_settings 표에 저장되고, 모든 화면이 그 값을 쓴다.
// 표가 아직 없거나 칸이 비어 있으면 배포 환경변수(EXPO_PUBLIC_BIZ_*) 값을 쓴다.
// 값이 비어 있으면 화면 하단 사업자 정보는 보이지 않고, 약관에는 [ ] 자리표시가 남는다.
const env = (v: string | undefined) => (v || '').trim();
const ENV = {
  companyName: env(process.env.EXPO_PUBLIC_BIZ_COMPANY_NAME),
  ceo: env(process.env.EXPO_PUBLIC_BIZ_CEO),
  bizNumber: env(process.env.EXPO_PUBLIC_BIZ_NUMBER),
  mailOrderNumber: env(process.env.EXPO_PUBLIC_BIZ_MAIL_ORDER_NUMBER),
  reportNumber: env(process.env.EXPO_PUBLIC_BIZ_REPORT_NUMBER),
  address: env(process.env.EXPO_PUBLIC_BIZ_ADDRESS),
  phone: env(process.env.EXPO_PUBLIC_BIZ_PHONE),
  email: env(process.env.EXPO_PUBLIC_BIZ_EMAIL),
  privacyOfficer: env(process.env.EXPO_PUBLIC_BIZ_PRIVACY_OFFICER),
  privacyContact: env(process.env.EXPO_PUBLIC_BIZ_PRIVACY_CONTACT),
};

export type BusinessKey = keyof typeof ENV;

export const BUSINESS: Record<BusinessKey, string> = { ...ENV };

// 앱 칸 이름 ↔ DB 칸 이름
export const BUSINESS_COLUMNS: Record<BusinessKey, string> = {
  companyName: 'company_name',
  ceo: 'representative',
  bizNumber: 'business_registration_number',
  mailOrderNumber: 'mail_order_number',
  reportNumber: 'business_report_number',
  address: 'address',
  phone: 'phone',
  email: 'email',
  privacyOfficer: 'privacy_officer',
  privacyContact: 'privacy_contact',
};

const listeners = new Set<() => void>();
let loading: Promise<boolean> | null = null;
// platform_settings 표를 쓸 수 있는지 (SQL 실행 전이면 false)
let tableReady = false;

function apply(row: Record<string, any> | null) {
  for (const k of Object.keys(BUSINESS_COLUMNS) as BusinessKey[]) {
    const v = row ? String(row[BUSINESS_COLUMNS[k]] ?? '').trim() : '';
    BUSINESS[k] = v || ENV[k];
  }
  listeners.forEach((f) => f());
}

// 한 번만 불러온다. force=true 면 다시 불러온다 (운영자가 저장한 직후)
export function loadBusiness(force = false): Promise<boolean> {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    if (error) {
      tableReady = false;
      return false;
    }
    tableReady = true;
    apply(data);
    return true;
  })();
  return loading;
}

export function businessTableReady() {
  return tableReady;
}

// 화면에서 사업자 정보를 쓸 때: 불러오기가 끝나면 다시 그린다
export function useBusiness() {
  const [, setTick] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    listeners.add(f);
    loadBusiness().finally(() => setReady(true));
    return () => {
      listeners.delete(f);
    };
  }, []);
  return { business: BUSINESS, ready };
}

export async function saveBusiness(values: Record<BusinessKey, string>): Promise<'ok' | 'not_ready' | 'error'> {
  const row: Record<string, any> = { id: 1, updated_at: new Date().toISOString() };
  for (const k of Object.keys(BUSINESS_COLUMNS) as BusinessKey[]) row[BUSINESS_COLUMNS[k]] = (values[k] || '').trim() || null;
  const { error } = await supabase.from('platform_settings').upsert(row, { onConflict: 'id' });
  if (error) return error.code === 'PGRST205' || error.code === '42P01' ? 'not_ready' : 'error';
  await loadBusiness(true);
  return 'ok';
}

// 법에서 표시하라고 정한 항목이 모두 채워졌는지
export function businessInfoReady() {
  const b = BUSINESS;
  return !!(b.companyName && b.ceo && b.bizNumber && b.mailOrderNumber && b.address && (b.phone || b.email));
}

// 국내결혼중개업 신고를 마쳤는지. 신고 전에는 파트너 공개 소개(광고)를 보여주지 않는다.
export function adsAllowed() {
  return !!BUSINESS.reportNumber;
}

// 약관 문장에 넣을 값: 비어 있으면 [ ] 자리표시
export const biz = (value: string, placeholder: string) => value || `[${placeholder}]`;
