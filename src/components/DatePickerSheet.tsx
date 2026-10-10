import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import BottomSheet from '@/components/BottomSheet';
import CalendarGrid, { WEEKDAYS, sameDay, startOfDay, toDateKey } from '@/components/CalendarGrid';
import { dateKeyToMeetingAt } from '@/lib/schedule';

interface DatePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  title?: string;
  initialDate?: Date;
}

// 연결자가 만남 날짜를 직접 정하거나 바꿀 때 쓰는 시트 (시간·장소는 회원끼리 정한다)
export default function DatePickerSheet({ visible, onClose, onConfirm, title = '만남 날짜 선택', initialDate }: DatePickerSheetProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    if (visible) setSelectedDate(initialDate ? startOfDay(initialDate) : null);
  }, [visible]);

  const summary = selectedDate
    ? `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${WEEKDAYS[selectedDate.getDay()]})`
    : '날짜를 선택해주세요';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <CalendarGrid
        minDate={today}
        initialMonth={initialDate}
        isSelected={(d) => !!selectedDate && sameDay(d, selectedDate)}
        onPress={setSelectedDate}
      />
      <Text style={styles.summary}>{summary}</Text>
      <Text style={styles.hint}>시간과 장소는 두 회원이 서로 연락해 정해요</Text>
      <TouchableOpacity
        style={[styles.confirmBtn, !selectedDate && styles.confirmBtnDisabled]}
        disabled={!selectedDate}
        onPress={() => selectedDate && onConfirm(new Date(dateKeyToMeetingAt(toDateKey(selectedDate))))}
      >
        <Text style={styles.confirmBtnText}>이 날짜로 정하기</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    fontSize: 14,
    color: '#322F38',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 16,
  },
  hint: {
    fontSize: 12,
    color: '#98959E',
    textAlign: 'center',
    marginTop: 4,
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
