import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 'YYYY-MM-DD' (로컬 날짜 기준)
export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CalendarGridProps {
  isSelected: (d: Date) => boolean;
  onPress: (d: Date) => void;
  minDate: Date;
  maxDate?: Date;
  initialMonth?: Date;
}

// 월 단위 달력. 이전/다음 달 이동, minDate~maxDate 밖의 날짜는 누를 수 없다.
export default function CalendarGrid({ isSelected, onPress, minDate, maxDate, initialMonth }: CalendarGridProps) {
  const today = startOfDay(new Date());
  const base = initialMonth ?? minDate;
  const [month, setMonth] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));

  const cells = useMemo(() => {
    const list: (Date | null)[] = Array(month.getDay()).fill(null);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) list.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [month]);

  const canPrev = month > new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canNext = !maxDate || new Date(month.getFullYear(), month.getMonth() + 1, 1) <= maxDate;

  return (
    <View>
      <View style={styles.monthRow}>
        <TouchableOpacity
          style={styles.monthBtn}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={!canPrev}
          accessibilityLabel="이전 달"
        >
          <Text style={[styles.monthArrow, !canPrev && styles.disabledText]}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{month.getFullYear()}년 {month.getMonth() + 1}월</Text>
        <TouchableOpacity
          style={styles.monthBtn}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          disabled={!canNext}
          accessibilityLabel="다음 달"
        >
          <Text style={[styles.monthArrow, !canNext && styles.disabledText]}>›</Text>
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
          const disabled = d < startOfDay(minDate) || (!!maxDate && d > maxDate);
          const selected = isSelected(d);
          return (
            <View key={d.toISOString()} style={styles.cell}>
              <TouchableOpacity
                style={[styles.day, selected && styles.daySelected, sameDay(d, today) && !selected && styles.dayToday]}
                disabled={disabled}
                onPress={() => onPress(d)}
              >
                <Text style={[styles.dayText, disabled && styles.disabledText, selected && styles.daySelectedText]}>
                  {d.getDate()}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
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
    color: '#322F38',
  },
  monthText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#322F38',
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
    color: '#98959E',
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
    color: '#322F38',
  },
  daySelectedText: {
    color: '#fff',
    fontWeight: '700',
  },
  disabledText: {
    color: '#CBC8D1',
  },
});
