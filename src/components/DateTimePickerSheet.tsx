import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from '@/components/BottomSheet';

interface DateTimePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  title?: string;
  initialDate?: Date;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 만남 시간으로 고를 수 있는 시각 (30분 단위, 10:00 ~ 22:00)
const TIMES = Array.from({ length: 25 }, (_, i) => {
  const minutes = 10 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 달력에서 날짜를, 아래 목록에서 시간을 골라 일정을 정하는 시트
export default function DateTimePickerSheet({ visible, onClose, onConfirm, title = '만남 일정 선택', initialDate }: DateTimePickerSheetProps) {
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const base = initialDate ?? null;
    setSelectedDate(base ? startOfDay(base) : null);
    setSelectedTime(base ? `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}` : null);
    const m = base ?? today;
    setMonth(new Date(m.getFullYear(), m.getMonth(), 1));
  }, [visible]);

  // 해당 월 달력 칸: 앞쪽 빈칸 + 날짜
  const cells = useMemo(() => {
    const first = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const list: (Date | null)[] = Array(first).fill(null);
    for (let d = 1; d <= days; d++) list.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [month]);

  const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const now = new Date();
  const isTimePast = (time: string) => {
    if (!selectedDate || !sameDay(selectedDate, today)) return false;
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
      <View style={styles.monthRow}>
        <TouchableOpacity
          style={styles.monthBtn}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={isCurrentMonth}
          accessibilityLabel="이전 달"
        >
          <Text style={[styles.monthArrow, isCurrentMonth && styles.disabledText]}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{month.getFullYear()}년 {month.getMonth() + 1}월</Text>
        <TouchableOpacity
          style={styles.monthBtn}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          accessibilityLabel="다음 달"
        >
          <Text style={styles.monthArrow}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {WEEKDAYS.map((w, i) => (
          <View key={w} style={styles.cell}>
            <Text style={[styles.weekday, i === 0 && styles.sunday]}>{w}</Text>
          </View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={styles.cell} />;
          const past = d < today;
          const selected = selectedDate && sameDay(d, selectedDate);
          return (
            <View key={d.toISOString()} style={styles.cell}>
              <TouchableOpacity
                style={[styles.day, selected && styles.daySelected, sameDay(d, today) && !selected && styles.dayToday]}
                disabled={past}
                onPress={() => {
                  setSelectedDate(d);
                  if (selectedTime && sameDay(d, today)) setSelectedTime(null);
                }}
              >
                <Text style={[styles.dayText, past && styles.disabledText, selected && styles.daySelectedText]}>
                  {d.getDate()}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>시간</Text>
      <View style={styles.times}>
        {TIMES.map((t) => {
          const disabled = !selectedDate || isTimePast(t);
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
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  monthArrow: {
    fontSize: 24,
    color: '#333',
  },
  monthText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
  },
  weekday: {
    fontSize: 12,
    color: '#999',
    paddingVertical: 4,
  },
  sunday: {
    color: '#E53935',
  },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: {
    borderWidth: 1,
    borderColor: '#5B21FF',
  },
  daySelected: {
    backgroundColor: '#5B21FF',
  },
  dayText: {
    fontSize: 14,
    color: '#333',
  },
  daySelectedText: {
    color: '#fff',
    fontWeight: '700',
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
