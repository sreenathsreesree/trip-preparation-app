import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SegmentedControl,
} from '@/components/ui';
import { spacing } from '@/theme';

import { useEnsureTripsLoaded, useToday } from '../hooks';
import { getTripLifecycle, type TripLifecycle, type TripSummary } from '../model';
import { useTripsStore } from '../tripsStore';
import { TripCard } from './TripCard';
import { useTripActions } from './TripActions';

const EMPTY: Record<TripLifecycle, { icon: 'map-marker-plus-outline' | 'flag-checkered' | 'archive-outline'; title: string; message: string }> = {
  active: {
    icon: 'map-marker-plus-outline',
    title: 'No active trips',
    message: 'Create a trip to get a preparation dashboard for packing, documents and more.',
  },
  completed: {
    icon: 'flag-checkered',
    title: 'No completed trips yet',
    message: 'When you are back from a trip, mark it as completed from its menu.',
  },
  archived: {
    icon: 'archive-outline',
    title: 'Nothing archived',
    message: 'Archive trips you want out of the way. They can be restored at any time.',
  },
};

export function TripsListScreen() {
  useEnsureTripsLoaded();
  const today = useToday();
  const trips = useTripsStore((state) => state.trips);
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const [filter, setFilter] = useState<TripLifecycle>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = trips.find((trip) => trip.id === selectedId);
  const { openActions, sheet, error: actionError } = useTripActions(selected);

  const groups = useMemo(() => {
    const byLifecycle: Record<TripLifecycle, TripSummary[]> = { active: [], completed: [], archived: [] };
    for (const trip of trips) byLifecycle[getTripLifecycle(trip)].push(trip);
    // Most recently finished/archived first.
    byLifecycle.completed.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    byLifecycle.archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
    return byLifecycle;
  }, [trips]);

  const visible = groups[filter];
  const newTrip = () => router.push('/trips/new');

  return (
    <Screen testID="trips-screen" onRefresh={() => void load()}>
      <ScreenHeader
        eyebrow="Expeditions"
        title="Trips"
        trailing={
          <View style={styles.headerActions}>
            <Button label="Join" icon="account-multiple-plus-outline" variant="secondary" size="sm" onPress={() => router.push('/join')} testID="trips-join" />
            <Button label="New trip" icon="plus" size="sm" onPress={newTrip} testID="trips-new" />
          </View>
        }
      />

      <SegmentedControl<TripLifecycle>
        accessibilityLabel="Filter trips"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: `Active ${groups.active.length}` },
          { value: 'completed', label: `Done ${groups.completed.length}` },
          { value: 'archived', label: `Archived ${groups.archived.length}` },
        ]}
      />

      {actionError ? <Notice tone="danger" title="Action failed" message={actionError} /> : null}

      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void load()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading trips…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={EMPTY[filter].icon}
          title={EMPTY[filter].title}
          message={EMPTY[filter].message}
          action={filter === 'active' ? { label: 'Plan a trip', icon: 'plus', onPress: newTrip } : undefined}
          testID={`trips-empty-${filter}`}
        />
      ) : (
        <View style={styles.list}>
          {visible.map((trip, index) => (
            <Animated.View key={trip.id} entering={FadeInDown.delay(index * 40).duration(240)}>
              <TripCard
                trip={trip}
                today={today}
                onMore={(target) => {
                  setSelectedId(target.id);
                  openActions();
                }}
              />
            </Animated.View>
          ))}
        </View>
      )}
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
});
