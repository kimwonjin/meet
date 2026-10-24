// 서울·경기는 넓어서 구·시까지 고른다 (지역 칸은 '서울'처럼 그대로, 구·시는 district 칸에 따로)
// SQL(add_district.sql) 실행 전이면 district 칸이 없어 고르기를 숨긴다
import { supabase } from './supabase';

export const DISTRICTS: Record<string, string[]> = {
  서울: ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'],
  경기: ['가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시', '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안산시', '안성시', '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시', '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시'],
};

// '서울 강남구' (구·시가 없으면 지역만)
export const placeLabel = (location?: string | null, district?: string | null) => [location, district].filter(Boolean).join(' ');

// 회원들의 구·시 (칸이 없으면 빈 목록)
export async function fetchDistricts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return out;
  const { data, error } = await supabase.from('users').select('id, district').in('id', list);
  if (error) return out;
  for (const r of (data || []) as any[]) if (r.district) out.set(r.id, r.district);
  return out;
}
