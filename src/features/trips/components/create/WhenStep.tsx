import { StyleSheet, View } from 'react-native';

import { AppText, DateRangeCalendar, Icon } from '@/components/ui';
import { formatDate, inclusiveDayCount, type ISODate } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import { useTripDraftStore } from '../../tripDraftStore';
import type { TripDraftErrors } from '../../validation';
import { TravellersEditor } from './RowEditors';

function DateSummary({ label, value }: { label: string; value: ISODate | null }) {
  return (
    <View style={styles.dateBox}>
      <AppText variant="label" tone="textMuted">
        {label}
      </AppText>
      <AppText variant="title" tone={value ? 'textPrimary' : 'textMuted'}>
        {value ? formatDate(value, { withYear: true }) : 'Select'}
      </AppText>
    </View>
  );
}

export function WhenStep({ errors }: { errors: TripDraftErrors }) {
  const startDate = useTripDraftStore((state) => state.draft.startDate);
  const endDate = useTripDraftStore((state) => state.draft.endDate);
  const minStartDate = useTripDraftStore((state) => state.minStartDate);
  const setDates = useTripDraftStore((state) => state.setDates);

  const dateError = errors.startDate ?? errors.endDate;
  const days = startDate && endDate ? inclusiveDayCount(startDate, endDate) : null;

  return (
    <View style={styles.container}>
      <View style={styles.dateRow}>
        <DateSummary label="Departs" value={startDate} />
        <Icon name="arrow-right" tone="textMuted" />
        <DateSummary label="Returns" value={endDate} />
      </View>
      {days ? (
        <AppText variant="caption" tone="accent">
          {days} {days === 1 ? 'day' : 'days'} on the road
        </AppText>
      ) : (
        <AppText variant="caption" tone="textMuted">
          Tap your departure day, then your return day.
        </AppText>
      )}

      <DateRangeCalendar
        startDate={startDate}
        endDate={endDate}
        minDate={minStartDate}
        onChange={(range) => setDates(range.startDate, range.endDate)}
        testID="trip-calendar"
      />
      {dateError ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {dateError}
        </AppText>
      ) : null}

      <View style={styles.travellers}>
        <TravellersEditor errors={errors} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dateBox: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  travellers: {
    marginTop: spacing.sm,
  },
});
