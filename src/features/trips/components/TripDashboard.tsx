import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  SectionHeader,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDateRange } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { PrepSectionCard } from '../../preparation/components/PrepSectionCard';
import { getApplicableSections, groupItemsBySection } from '../../preparation/model';
import { usePrepStore, useTripChecklist } from '../../preparation/prepStore';
import { useToday, useTrip } from '../hooks';
import { describeTripTiming, type TripSummary } from '../model';
import { useTripsStore } from '../tripsStore';
import { ReadinessMeter } from './ReadinessMeter';
import { TripMetaTags } from './TripMetaTags';

function DashboardBody({ trip }: { trip: TripSummary }) {
  const today = useToday();
  const checklist = useTripChecklist(trip.id);
  const loadTrip = usePrepStore((state) => state.loadTrip);
  const forgetTrip = usePrepStore((state) => state.forgetTrip);
  const removeTrip = useTripsStore((state) => state.remove);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void loadTrip(trip.id);
  }, [trip.id, loadTrip]);

  const sections = getApplicableSections(trip.transportMode);
  const grouped = groupItemsBySection(checklist.items);

  async function handleDelete() {
    const confirmed = await confirmAction({
      title: 'Delete this trip?',
      message: `"${trip.name}" and its checklist will be permanently removed from this device.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeTrip(trip.id);
      forgetTrip(trip.id);
      router.replace('/trips');
    } catch (error) {
      setDeleteError(toErrorMessage(error, 'Could not delete the trip.'));
      setDeleting(false);
    }
  }

  return (
    <Screen testID="trip-dashboard" onRefresh={() => void loadTrip(trip.id)} bottomInset>
      <ScreenHeader
        showBack
        eyebrow={describeTripTiming(trip, today)}
        title={trip.name}
        subtitle={`${trip.destination} · ${formatDateRange(trip.startDate, trip.endDate)}`}
      />

      <View style={styles.hero}>
        <TopoBackdrop opacity={0.4} />
        <View style={styles.heroContent}>
          <TripMetaTags trip={trip} />
          <ReadinessMeter progress={trip.progress} size="large" />
        </View>
      </View>

      <SectionHeader eyebrow="Mission control" title="Preparation areas" />

      {checklist.status === 'error' ? (
        <ErrorState
          message={checklist.error ?? 'Could not load this checklist.'}
          onRetry={() => void loadTrip(trip.id)}
        />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading checklist…" />
      ) : (
        <View style={styles.sections}>
          {sections.map((section, index) => (
            <Animated.View key={section} entering={FadeInDown.delay(index * 50).duration(260)}>
              <PrepSectionCard tripId={trip.id} section={section} items={grouped[section]} />
            </Animated.View>
          ))}
        </View>
      )}

      <View style={styles.danger}>
        {deleteError ? (
          <View style={styles.errorRow} accessibilityRole="alert">
            <Icon name="alert-circle-outline" tone="danger" size={16} />
            <AppText variant="caption" tone="danger">
              {deleteError}
            </AppText>
          </View>
        ) : null}
        <Button
          label="Delete trip"
          icon="trash-can-outline"
          variant="danger"
          size="sm"
          loading={deleting}
          onPress={() => void handleDelete()}
          testID="delete-trip"
        />
      </View>
    </Screen>
  );
}

export function TripDashboard({ tripId }: { tripId: string | undefined }) {
  const { trip, status, error, reload } = useTrip(tripId);

  if (trip) return <DashboardBody trip={trip} />;

  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Trip" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="map-marker-question-outline"
          title="Trip not found"
          message="It may have been deleted from this device."
          action={{ label: 'View all trips', onPress: () => router.replace('/trips') }}
        />
      ) : (
        <LoadingState label="Loading trip…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  heroContent: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  sections: {
    gap: spacing.md,
  },
  danger: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
