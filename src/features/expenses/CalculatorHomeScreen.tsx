import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Card, EmptyState, Icon, LoadingState, Tag } from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import { useEnsureTripsLoaded, useToday } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { useTripsStore } from '../trips/tripsStore';
import { pickActiveTrip } from './ledger';

function TripRow({ trip, active, today }: { trip: TripSummary; active: boolean; today: string }) {
  const phase = today < trip.startDate ? 'Upcoming' : today > trip.endDate ? 'Ended' : 'Happening now';
  return (
    <Card
      variant={active ? 'accent' : 'default'}
      onPress={() => router.push({ pathname: '/calculator/[tripId]', params: { tripId: trip.id } })}
      accessibilityLabel={`Open the calculator for ${trip.name}${active ? ', active trip' : ''}`}
      testID={`calc-trip-${trip.name}`}
    >
      <View style={styles.row}>
        <View style={[styles.icon, active && styles.iconActive]}>
          <Icon name="calculator-variant-outline" color={active ? colors.textOnAccent : colors.accent} />
        </View>
        <View style={styles.flex}>
          <AppText variant="title" numberOfLines={1}>
            {trip.name}
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {formatDateRange(trip.startDate, trip.endDate)}
          </AppText>
        </View>
        {active ? <Tag label="Active trip" icon="star" color={colors.accent} /> : <Tag label={phase} />}
      </View>
    </Card>
  );
}

/** Standalone entry: choose a trip to open its expenses, budget and calculators. */
export function CalculatorHomeScreen() {
  useEnsureTripsLoaded();
  const today = useToday();
  const status = useTripsStore((s) => s.status);
  const trips = useTripsStore((s) => s.trips);
  const visible = trips.filter((t) => !t.archivedAt);
  const active = pickActiveTrip(visible, today);
  const ordered = active ? [active, ...visible.filter((t) => t.id !== active.id)] : visible;

  return (
    <Screen testID="calc-home" bottomInset>
      <ScreenHeader showBack eyebrow="Money" title="Trip calculator" subtitle="Expenses, splits, budget and travel costs for each trip" />
      {status !== 'ready' && trips.length === 0 ? (
        <LoadingState label="Loading trips…" />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon="calculator-variant-outline"
          title="No trips yet"
          message="Create a trip first; each trip gets its own expenses and budget."
          action={{ label: 'Plan a trip', icon: 'plus', onPress: () => router.push('/trips/new') }}
          testID="calc-empty"
        />
      ) : (
        <View style={styles.list}>
          {ordered.map((trip) => (
            <TripRow key={trip.id} trip={trip} active={trip.id === active?.id} today={today} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
    gap: spacing.xxs,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  iconActive: {
    backgroundColor: colors.accent,
  },
});
