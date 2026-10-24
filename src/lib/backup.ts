// 운영자 '전체 백업 내려받기': 주요 표를 파일 하나(JSON)로 받아 보관한다 (무료 플랜은 자동 백업이 없음)
// 표마다 1000건씩 나눠 받는다. 아직 없는 표(SQL 실행 전)는 건너뛰고 파일에 적어 둔다.
// 알림 서명 키(push_keys)는 비밀 값이라 넣지 않는다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const BACKUP_TABLES = [
  'users', 'connectors', 'hopeful_requests', 'match_requests',
  'payments', 'wallet_charges', 'settlements', 'withdrawal_requests', 'refund_requests', 'connector_bank_accounts',
  'connector_alliances', 'connector_reviews',
  'chat_threads', 'chat_messages', 'notifications', 'match_reminders',
  'user_reports', 'user_blocks', 'user_consents', 'withdrawn_identities',
  'invite_links', 'invite_events', 'share_templates', 'platform_settings',
  'member_notes', 'feedback', 'avoid_contacts', 'push_subscriptions',
];

const PAGE = 1000;
const LAST_KEY = 'dudu_last_backup_at';
export const BACKUP_REMIND_DAYS = 30;

export type BackupResult = { fileName: string; tables: number; rows: number; skipped: string[]; json: string };

async function fetchAll(table: string): Promise<any[] | null> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (error) return from === 0 ? null : rows; // 처음부터 안 되면 없는 표로 본다
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function buildBackup(onProgress?: (done: number, total: number, table: string) => void): Promise<BackupResult> {
  const tables: Record<string, any[]> = {};
  const skipped: string[] = [];
  let rows = 0;
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const t = BACKUP_TABLES[i];
    onProgress?.(i, BACKUP_TABLES.length, t);
    const r = await fetchAll(t);
    if (r === null) { skipped.push(t); continue; }
    tables[t] = r;
    rows += r.length;
  }
  onProgress?.(BACKUP_TABLES.length, BACKUP_TABLES.length, '');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fileName = `dudu_backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const json = JSON.stringify({ app: 'dudu', kind: 'backup', created_at: now.toISOString(), tables, skipped }, null, 0);
  return { fileName, tables: Object.keys(tables).length, rows, skipped, json };
}

// 웹: 파일로 내려받기. 내려받기를 시작했으면 마지막 백업 시각을 이 기기에 남긴다
export async function downloadBackup(r: BackupResult): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([r.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = r.fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await AsyncStorage.setItem(LAST_KEY, new Date().toISOString()).catch(() => {});
  return true;
}

export async function getLastBackupAt(): Promise<string | null> {
  try { return await AsyncStorage.getItem(LAST_KEY); } catch { return null; }
}
