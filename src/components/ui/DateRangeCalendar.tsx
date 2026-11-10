import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  formatDateLong,
  formatMonthYear,
  getMonthGrid,
  getMonthOf,
  nextDateRange,
  shiftMonth,
  WEEKDAY_INITIALS,
  type DateRange,
  type ISODate,
  type WeekStart,
} from '@/lib/dates';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface DateRangeCalendarProps extends DateRange {
  /** Earliest selectable date (inclusive). */
  minDate: ISODate;
  onChange: (range: DateRange) => void;
  weekStart?: WeekStart;
  testID?: string;
}

/**
 * Pure React Native range picker so date selection looks and behaves the same
 * on iOS, Android and web (see `nextDateRange` for the tap rules).
 */
export function DateRangeCalendar({
  startDate,
  endDate,
  minDate,
  onChange,
  weekStart = 'monday',
  testID,
}: DateRangeCalendarProps) {
  const [visible, setVisible] = useState(() => getMonthOf(startDate ?? minDate));
  const weeks = useMemo(
    () => getMonthGrid(visible.year, visible.month, weekStart),
    [visible.year, visible.month, weekStart],
  );
  const minMonth = getMonthOf(minDate);
  const canGoBack =
    visible.year > minMonth.year || (visible.year === minMonth.year && visible.month > minMonth.month);

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel="Previous month"
          variant="plain"
          disabled={!canGoBack}
          onPress={() => setVisible(shiftMonth(visible.year, visible.month, -1))}
        />
        <AppText variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
          {formatMonthYear(visible.year, visible.month)}
        </AppText>
        <IconButton
          icon="chevron-right"
          accessibilityLabel="Next month"
          variant="plain"
          testID={testID ? `${testID}-next-month` : undefined}
          onPress={() => setVisible(shiftMonth(visible.year, visible.month, 1))}
        />
      </View>

      <View style={styles.week}>
        {WEEKDAY_INITIALS[weekStart].map((initial, index) => (
          <View key={`${initial}-${index}`} style={styles.cell}>
            <AppText variant="label" tone="textMuted">
              {initial}
            </AppText>
          </View>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.week}>
          {week.map((date, dayIndex) => {
            if (!date) return <View key={`pad-${dayIndex}`} style={styles.cell} />;

            const disabled = date < minDate;
            const isStart = date === startDate;
            const isEnd = date === endDate;
            const inRange = Boolean(startDate && endDate && date > startDate && date < endDate);
            const isEdge = isStart || isEnd;
            const hasRange = Boolean(startDate && endDate && startDate !== endDate);
            const day = Number(date.slice(8));

            const stateLabel = isStart
              ? ', trip start'
              : isEnd
                ? ', trip end'
                : inRange
                  ? ', within trip'
                  : '';

            return (
              <View key={date} style={styles.cell}>
                {/* Range band behind the day circles. */}
                {(inRange || (hasRange && isEdge)) && (
                  <View
                    style={[
                      styles.band,
                      isStart && styles.bandStart,
                      isEnd && styles.bandEnd,
                    ]}
                  />
                )}
                <Pressable
                  testID={`calendar-day-${date}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDateLong(date)}${stateLabel}`}
                  accessibilityState={{ disabled, selected: isEdge }}
                  disabled={disabled}
                  hitSlop={2}
                  onPress={() => {
                    selectionFeedback();
                    onChange(nextDateRange({ startDate, endDate }, date));
                  }}
                  style={({ pressed }) => [
                    styles.day,
                    isEdge && styles.dayEdge,
                    pressed && !isEdge && styles.dayPressed,
                  ]}
                >
                  <AppText
                    variant={isEdge ? 'bodyStrong' : 'body'}
                    tone={isEdge ? 'textOnAccent' : disabled ? 'textMuted' : 'textPrimary'}
                    style={disabled ? styles.dayDisabledText : undefined}
                  >
                    {day}
                  </AppText>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const DAY_SIZE = 40;

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  week: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    height: DAY_SIZE + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 2,
    bottom: 2,
    backgroundColor: colors.accentSoft,
  },
  bandStart: {
    left: '50%',
  },
  bandEnd: {
    right: '50%',
  },
  day: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayEdge: {
    backgroundColor: colors.accent,
  },
  dayPressed: {
    backgroundColor: colors.surfacePressed,
  },
  dayDisabledText: {
    opacity: 0.5,
  },
});
