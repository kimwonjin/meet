// 직업 분류(하나)·해당 조건(여러 개, '해당 없음'은 혼자만). 회원이 직접 고르고 파트너에게만 보인다
// SQL(add_company_and_avoid.sql) 실행 전이면 칸이 없어 빈 목록
import { supabase } from './supabase';

export const JOB_CATEGORIES = ['대기업 정규직', '공기업·공무원', '중견·중소기업', '사업가·기업 대표', '의사', '회계사·세무사·노무사·변호사', '금융직', '교사·교육직', '이외 전문직', '해당하는 직업 없음'];
export const EXTRA_CONDITIONS = ['연봉 1억 이상', '개인 자산 10억 이상', '전문직 (의사·변호사·금융직 등)', '가족 자산 50억 이상', '연 매출 50억 이상 대표', '해당 없음'];

export function toggleCondition(list: string[], v: string) {
  if (v === '해당 없음') return list.includes(v) ? [] : [v];
  const rest = list.filter((x) => x !== '해당 없음');
  return rest.includes(v) ? rest.filter((x) => x !== v) : [...rest, v];
}

export type MemberDetail = { jobCategory: string | null; conditions: string[] };

// 파트너 화면에서 후보 회원들의 직업 분류·조건
export async function fetchMemberDetails(ids: string[]): Promise<Map<string, MemberDetail>> {
  const out = new Map<string, MemberDetail>();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  const { data, error } = await supabase.from('users').select('id, job_category, extra_conditions').in('id', list);
  if (error) return out;
  for (const r of (data || []) as any[]) {
    out.set(r.id, { jobCategory: r.job_category || null, conditions: ((r.extra_conditions || []) as string[]).filter((c) => c !== '해당 없음') });
  }
  return out;
}
