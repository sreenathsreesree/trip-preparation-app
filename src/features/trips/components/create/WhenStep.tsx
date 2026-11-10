import { StyleSheet, View } from 'react-native';

import { AppText, DateRangeCalendar, Icon, Stepper } from '@/components/ui';
import { formatDate, inclusiveDayCount, type ISODate } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import { useTripDraftStore } from '../../tripDraftStore';
import { TRIP_LIMITS, type TripDraftErrors } from '../../validation';

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

export function WhenStep({ errors, today }: { errors: TripDraftErrors; today: ISODate }) {
  const draft = useTripDraftStore((state) => state.draft);
  const update = useTripDraftStore((state) => state.update);
  const setDates = useTripDraftStore((state) => state.setDates);

  const dateError = errors.startDate ?? errors.endDate;
  const days =
    draft.startDate && draft.endDate ? inclusiveDayCount(draft.startDate, draft.endDate) : null;

  return (
    <View style={styles.container}>
      <View style={styles.dateRow}>
        <DateSummary label="Departs" value={draft.startDate} />
        <Icon name="arrow-right" tone="textMuted" />
        <DateSummary label="Returns" value={draft.endDate} />
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
        startDate={draft.startDate}
        endDate={draft.endDate}
        minDate={today}
        onChange={({ startDate, endDate }) => setDates(startDate, endDate)}
        testID="trip-calendar"
      />
      {dateError ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {dateError}
        </AppText>
      ) : null}

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Travellers
        </AppText>
        <Stepper
          label="Adults"
          description="Age 12 and above"
          value={draft.adults}
          min={TRIP_LIMITS.adultsMin}
          max={TRIP_LIMITS.adultsMax}
          onChange={(adults) => update({ adults })}
          testID="adults-stepper"
        />
        <Stepper
          label="Children"
          description="Under 12"
          value={draft.children}
          min={TRIP_LIMITS.childrenMin}
          max={TRIP_LIMITS.childrenMax}
          onChange={(children) => update({ children })}
          testID="children-stepper"
        />
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
  group: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
