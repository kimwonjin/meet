// 엑셀에서 바로 열리는 CSV 만들기·내려받기 (웹)
// 파일 이름은 영문으로 (한글 이름은 일부 브라우저에서 "download"로 바뀐다)
// 한글이 깨지지 않게 맨 앞에 BOM을 붙이고, 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싼다
// 계좌번호처럼 숫자로 바뀌면 안 되는 칸은 text()로 감싸 엑셀이 글자로 읽게 한다
import { Platform } from 'react-native';

type Cell = string | number | null | undefined | { text: string };

export const text = (v: string | null | undefined): Cell => ({ text: v ?? '' });

function cell(v: Cell) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return `="${String(v.text).replace(/"/g, '""')}"`;
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: Cell[][]) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const ymd = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
