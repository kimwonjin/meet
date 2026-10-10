import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import BottomSheet from '@/components/BottomSheet';
import CalendarGrid, { WEEKDAYS, startOfDay, toDateKey } from '@/components/CalendarGrid';

// 고를 수 있는 기간: 내일부터 30일
const RANGE_DAYS = 30;

interface AvailableDatesSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (dateKeys: string[]) => void;
  initialDates?: string[];
  confirmLabel?: string;
}

// 회원이 매칭 승인 시 만날 수 있는 날짜를 여러 개 고르는 시트
export default function AvailableDatesSheet({ visible, onClose, onConfirm, initialDates, confirmLabel = '승인하기' }: AvailableDatesSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const today = startOfDay(new Date());
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + RANGE_DAYS);

  useEffect(() => {
    if (visible) setSelected(initialDates ?? []);
  }, [visible]);

  function toggle(d: Date) {
    const key = toDateKey(d);
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()));
  }

  const summary = selected.length
    ? selected
        .slice(0, 4)
        .map((k) => {
          const [y, m, d] = k.split('-').map(Number);
          return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
        })
        .join(', ') + (selected.length > 4 ? ` 외 ${selected.length - 4}일` : '')
    : '날짜를 하나 이상 골라주세요';

  return (
    <BottomSheet visible={visible} onClose={onClose} title="만날 수 있는 날짜">
      <Text style={styles.guide}>가능한 날짜를 모두 골라주세요. 상대와 겹치는 날 중 가장 빠른 날로 소개팅 날짜가 정해지고, 시간과 장소는 서로 연락해 정해요.</Text>
      <CalendarGrid
        minDate={minDate}
        maxDate={maxDate}
        isSelected={(d) => selected.includes(toDateKey(d))}
        onPress={toggle}
      />
      <Text style={styles.summary}>{summary}</Text>
      <TouchableOpacity
        style={[styles.confirmBtn, selected.length === 0 && styles.confirmBtnDisabled]}
        disabled={selected.length === 0}
        onPress={() => onConfirm(selected)}
      >
        <Text style={styles.confirmBtnText}>
          {selected.length ? `${selected.length}일 선택 · ${confirmLabel}` : confirmLabel}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  guide: {
    fontSize: 13,
    lineHeight: 19,
    color: '#65626B',
    marginBottom: 12,
  },
  summary: {
    fontSize: 13,
    color: '#65626B',
    textAlign: 'center',
    marginTop: 16,
  },
  confirmBtn: {
    backgroundColor: '#5B21FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
