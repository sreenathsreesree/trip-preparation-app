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
  SegmentedControl,
} from '@/components/ui';
import { spacing } from '@/theme';

import { useEnsureTripsLoaded, useToday } from '../hooks';
import { getTripPhase } from '../model';
import { useTripsStore } from '../tripsStore';
import { TripCard } from './TripCard';

type Filter = 'active' | 'past';

export function TripsListScreen() {
  useEnsureTripsLoaded();
  const today = useToday();
  const trips = useTripsStore((state) => state.trips);
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const [filter, setFilter] = useState<Filter>('active');

  const { active, past } = useMemo(() => {
    const activeTrips = trips.filter((trip) => getTripPhase(trip, today) !== 'completed');
    // Most recent past trips first.
    const pastTrips = trips
      .filter((trip) => getTripPhase(trip, today) === 'completed')
      .sort((a, b) => b.endDate.localeCompare(a.endDate));
    return { active: activeTrips, past: pastTrips };
  }, [trips, today]);

  const visible = filter === 'active' ? active : past;
  const newTrip = () => router.push('/trips/new');

  return (
    <Screen testID="trips-screen" onRefresh={() => void load()}>
      <ScreenHeader
        eyebrow="Expeditions"
        title="Trips"
        trailing={<Button label="New trip" icon="plus" size="sm" onPress={newTrip} testID="trips-new" />}
      />

      <SegmentedControl<Filter>
        accessibilityLabel="Filter trips"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: `Upcoming · ${active.length}` },
          { value: 'past', label: `Past · ${past.length}` },
        ]}
      />

      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void load()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading trips…" />
      ) : visible.length === 0 ? (
        filter === 'active' ? (
          <EmptyState
            icon="map-marker-plus-outline"
            title="No upcoming trips"
            message="Create a trip to get a preparation dashboard for packing, documents and more."
            action={{ label: 'Plan a trip', icon: 'plus', onPress: newTrip }}
            testID="trips-empty"
          />
        ) : (
          <EmptyState
            icon="history"
            title="No past trips yet"
            message="Trips move here once their end date has passed."
          />
        )
      ) : (
        <View style={styles.list}>
          {visible.map((trip, index) => (
            <Animated.View key={trip.id} entering={FadeInDown.delay(index * 50).duration(260)}>
              <TripCard trip={trip} today={today} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
});
