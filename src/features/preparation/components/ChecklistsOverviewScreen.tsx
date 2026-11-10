import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  ProgressBar,
} from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { colors, spacing } from '@/theme';

import { useActiveTrips, useEnsureTripsLoaded, useToday } from '../../trips/hooks';
import { describeTripTiming, type TripSummary } from '../../trips/model';
import { useTripsStore } from '../../trips/tripsStore';
import {
  getApplicableSections,
  groupItemsBySection,
  PREP_SECTION_META,
  summarizeItems,
} from '../model';
import { usePrepStore, useTripChecklist } from '../prepStore';

function TripChecklistCard({ trip }: { trip: TripSummary }) {
  const today = useToday();
  const checklist = useTripChecklist(trip.id);
  const grouped = groupItemsBySection(checklist.items);

  return (
    <Card padding="none" testID={`checklist-trip-${trip.id}`}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <AppText variant="h3" numberOfLines={1}>
            {trip.name}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {formatDateRange(trip.startDate, trip.endDate)} · {describeTripTiming(trip, today)}
          </AppText>
        </View>
        <AppText variant="captionStrong" tone="accent">
          {trip.progress.done}/{trip.progress.total}
        </AppText>
      </View>

      {checklist.status === 'error' ? (
        <AppText variant="caption" tone="danger" style={styles.message}>
          {checklist.error}
        </AppText>
      ) : checklist.status !== 'ready' ? (
        <AppText variant="caption" tone="textMuted" style={styles.message}>
          Loading…
        </AppText>
      ) : (
        getApplicableSections(trip.transportMode).map((section) => {
          const meta = PREP_SECTION_META[section];
          const { total, done } = summarizeItems(grouped[section]);
          return (
            <Pressable
              key={section}
              accessibilityRole="button"
              accessibilityLabel={`${trip.name}, ${meta.title}: ${done} of ${total} ready`}
              onPress={() =>
                router.push({ pathname: '/trips/[tripId]/[section]', params: { tripId: trip.id, section } })
              }
              style={({ pressed }) => [styles.sectionRow, pressed && styles.pressed]}
            >
              <Icon name={meta.icon} color={meta.tint} size={18} />
              <AppText variant="body" style={styles.sectionTitle} numberOfLines={1}>
                {meta.title}
              </AppText>
              <View style={styles.bar}>
                <ProgressBar value={total === 0 ? 0 : done / total} color={meta.tint} height={4} />
              </View>
              <AppText variant="caption" tone="textMuted" style={styles.count}>
                {done}/{total}
              </AppText>
              <Icon name="chevron-right" size={18} tone="textMuted" />
            </Pressable>
          );
        })
      )}
    </Card>
  );
}

export function ChecklistsOverviewScreen() {
  useEnsureTripsLoaded();
  const today = useToday();
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const activeTrips = useActiveTrips(today);
  const loadTrip = usePrepStore((state) => state.loadTrip);

  const activeIds = activeTrips.map((trip) => trip.id).join(',');
  useEffect(() => {
    for (const id of activeIds.split(',')) if (id) void loadTrip(id);
  }, [activeIds, loadTrip]);

  return (
    <Screen testID="checklists-screen" onRefresh={() => void load()}>
      <ScreenHeader
        eyebrow="Readiness"
        title="Checklists"
        subtitle="Every preparation area across your upcoming trips."
      />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void load()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading checklists…" />
      ) : activeTrips.length === 0 ? (
        <EmptyState
          icon="clipboard-check-outline"
          title="No active checklists"
          message="Checklists appear here for trips that are upcoming or in progress."
          action={{ label: 'Plan a trip', icon: 'plus', onPress: () => router.push('/trips/new') }}
        />
      ) : (
        <View style={styles.list}>
          {activeTrips.map((trip) => (
            <TripChecklistCard key={trip.id} trip={trip} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.lg,
  },
  flex: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  message: {
    padding: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
  sectionTitle: {
    flex: 1,
  },
  bar: {
    width: 64,
  },
  count: {
    minWidth: 32,
    textAlign: 'right',
  },
});
