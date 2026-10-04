import { supabase } from './supabase';

export type Review = {
  id: string;
  rating: number;
  content: string | null;
  created_at: string;
  writerName: string;
};

export type ReviewSummary = { avg: number; count: number };

// 후기 작성자 이름은 성만 보여준다: "김민지" → "김**"
export function maskName(name?: string | null) {
  if (!name) return '회원';
  return name[0] + '*'.repeat(Math.max(1, name.length - 1));
}

export function formatStars(rating: number) {
  const r = Math.round(rating);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

// 파트너 여러 명의 평균 별점·후기 수
export async function fetchReviewSummaries(connectorIds: string[]): Promise<Record<string, ReviewSummary>> {
  if (connectorIds.length === 0) return {};
  const { data } = await supabase.from('connector_reviews').select('connector_id, rating').in('connector_id', connectorIds);
  const result: Record<string, ReviewSummary> = {};
  for (const row of data || []) {
    const s = (result[row.connector_id] ||= { avg: 0, count: 0 });
    s.avg = (s.avg * s.count + row.rating) / (s.count + 1);
    s.count += 1;
  }
  return result;
}

export async function fetchConnectorReviews(connectorId: string): Promise<Review[]> {
  const { data } = await supabase
    .from('connector_reviews')
    .select('*')
    .eq('connector_id', connectorId)
    .order('created_at', { ascending: false });
  const rows = data || [];
  const writerIds = [...new Set(rows.map((r: any) => r.hopeful_id))];
  const { data: writers } = writerIds.length
    ? await supabase.from('users').select('id, name').in('id', writerIds)
    : { data: [] as any[] };
  return rows.map((r: any) => ({
    id: r.id,
    rating: r.rating,
    content: r.content,
    created_at: r.created_at,
    writerName: maskName((writers || []).find((w: any) => w.id === r.hopeful_id)?.name),
  }));
}

// 내가 후기를 남긴 매칭 id 목록
export async function fetchMyReviewedMatchIds(hopefulId: string): Promise<string[]> {
  const { data } = await supabase.from('connector_reviews').select('match_request_id').eq('hopeful_id', hopefulId);
  return (data || []).map((r: any) => r.match_request_id);
}

export async function submitReview(params: {
  matchId: string;
  hopefulId: string;
  connectorId: string;
  rating: number;
  content: string;
}) {
  return supabase.from('connector_reviews').insert([{
    match_request_id: params.matchId,
    hopeful_id: params.hopefulId,
    connector_id: params.connectorId,
    rating: params.rating,
    content: params.content.trim() || null,
  }]);
}
