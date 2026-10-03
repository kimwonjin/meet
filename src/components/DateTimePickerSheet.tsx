import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from '@/components/BottomSheet';
import CalendarGrid, { WEEKDAYS, sameDay, startOfDay } from '@/components/CalendarGrid';

interface DateTimePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  title?: string;
  initialDate?: Date;
}

// 만남 시간으로 고를 수 있는 시각 (30분 단위, 10:00 ~ 22:00)
const TIMES = Array.from({ length: 25 }, (_, i) => {
  const minutes = 10 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

// 달력에서 날짜를, 아래 목록에서 시간을 골라 일정을 정하는 시트
export default function DateTimePickerSheet({ visible, onClose, onConfirm, title = '만남 일정 선택', initialDate }: DateTimePickerSheetProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const base = initialDate ?? null;
    setSelectedDate(base ? startOfDay(base) : null);
    setSelectedTime(base ? `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}` : null);
  }, [visible]);

  const now = new Date();
  const isTimePastOn = (day: Date, time: string) => {
    if (!sameDay(day, today)) return false;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
  };

  function handleConfirm() {
    if (!selectedDate || !selectedTime) return;
    const [h, m] = selectedTime.split(':').map(Number);
    onConfirm(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, m));
  }

  const summary = selectedDate
    ? `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${WEEKDAYS[selectedDate.getDay()]})${selectedTime ? ` ${selectedTime}` : ''}`
    : '날짜를 선택해주세요';

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <CalendarGrid
        minDate={today}
        initialMonth={initialDate}
        isSelected={(d) => !!selectedDate && sameDay(d, selectedDate)}
        onPress={(d) => {
          setSelectedDate(d);
          if (selectedTime && sameDay(d, today) && isTimePastOn(d, selectedTime)) setSelectedTime(null);
        }}
      />

      <Text style={styles.sectionLabel}>시간</Text>
      <View style={styles.times}>
        {TIMES.map((t) => {
          const disabled = !selectedDate || isTimePastOn(selectedDate, t);
          const selected = selectedTime === t;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.time, selected && styles.timeSelected, disabled && styles.timeDisabled]}
              disabled={disabled}
              onPress={() => setSelectedTime(t)}
            >
              <Text style={[styles.timeText, selected && styles.timeSelectedText, disabled && styles.disabledText]}>{t}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.summary}>{summary}</Text>
      <TouchableOpacity
        style={[styles.confirmBtn, !(selectedDate && selectedTime) && styles.confirmBtnDisabled]}
        disabled={!(selectedDate && selectedTime)}
        onPress={handleConfirm}
      >
        <Text style={styles.confirmBtnText}>이 일정으로 확정</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
  },
  disabledText: {
    color: '#ccc',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  times: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  time: {
    width: '22%',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  timeSelected: {
    backgroundColor: '#5B21FF',
    borderColor: '#5B21FF',
  },
  timeDisabled: {
    backgroundColor: '#fafafa',
  },
  timeText: {
    fontSize: 13,
    color: '#333',
  },
  timeSelectedText: {
    color: '#fff',
    fontWeight: '700',
  },
  summary: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
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
