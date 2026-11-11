import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import {
  AppText,
  Button,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  SectionHeader,
} from '@/components/ui';
import { formatDateLong } from '@/lib/dates';
import { ContinuePlanningCard } from '@/features/planner/components/ContinuePlanningCard';
import { SECTION_META, STANDARD_SECTION_KINDS } from '@/features/preparation/model';
import { NextTripHero } from '@/features/trips/components/NextTripHero';
import { TripCard } from '@/features/trips/components/TripCard';
import { openCount } from '@/features/preparation/readiness';
import { useCurrentTrips, useEnsureTripsLoaded, useToday } from '@/features/trips/hooks';
import { useTripsStore } from '@/features/trips/tripsStore';
import { colors, radii, spacing } from '@/theme';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const goToNewTrip = () => router.push('/trips/new');

function Stat({ value, label, tone }: { value: number; label: string; tone: 'accent' | 'info' | 'warning' }) {
  return (
    <View style={styles.stat}>
      <AppText variant="h2" tone={tone}>
        {value}
      </AppText>
      <AppText variant="label" tone="textMuted">
        {label}
      </AppText>
    </View>
  );
}

function FirstTripCard() {
  return (
    <View style={styles.firstTrip} testID="home-empty">
      <TopoBackdrop opacity={0.6} />
      <View style={styles.firstTripContent}>
        <AppText variant="label" tone="accent">
          Base camp
        </AppText>
        <AppText variant="h2">Plan your first trip</AppText>
        <AppText variant="body" tone="textSecondary">
          Tell us where you&apos;re going and how you&apos;re travelling. We&apos;ll set up a
          preparation dashboard covering:
        </AppText>
        <View style={styles.sectionList}>
          {STANDARD_SECTION_KINDS.map((section) => (
            <View key={section} style={styles.sectionItem}>
              <Icon name={SECTION_META[section].icon} size={16} color={SECTION_META[section].tint} />
              <AppText variant="caption" tone="textSecondary">
                {SECTION_META[section].title}
              </AppText>
            </View>
          ))}
        </View>
        <Button label="Plan a trip" icon="plus" onPress={goToNewTrip} testID="home-plan-trip" />
      </View>
    </View>
  );
}

export function HomeScreen() {
  useEnsureTripsLoaded();
  const today = useToday();
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  const activeTrips = useCurrentTrips(today);

  const [nextTrip, ...laterTrips] = activeTrips;
  const totals = useMemo(
    () =>
      activeTrips.reduce(
        (acc, trip) => ({
          done: acc.done + trip.readiness.done,
          left: acc.left + openCount(trip.readiness),
          essentials: acc.essentials + openCount(trip.readiness.essential),
        }),
        { done: 0, left: 0, essentials: 0 },
      ),
    [activeTrips],
  );

  return (
    <Screen testID="home-screen" onRefresh={() => void load()}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Icon name="compass-rose" size={20} tone="textOnAccent" />
          </View>
          <View>
            <AppText variant="title">Trip Prep</AppText>
            <AppText variant="caption" tone="textMuted">
              {formatDateLong(today)}
            </AppText>
          </View>
        </View>
        <IconButton
          icon="plus"
          variant="accent"
          tone="textOnAccent"
          accessibilityLabel="Plan a new trip"
          onPress={goToNewTrip}
          testID="home-new-trip"
        />
      </View>

      <View style={styles.headline}>
        <AppText variant="label" tone="textMuted">
          {greeting()}
        </AppText>
        <AppText variant="display">
          Nothing forgotten.{'\n'}
          <AppText variant="display" tone="accent">
            Everything ready.
          </AppText>
        </AppText>
      </View>

      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void load()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading your trips…" />
      ) : nextTrip ? (
        <>
          <Animated.View entering={FadeInDown.duration(320)}>
            <NextTripHero trip={nextTrip} today={today} />
          </Animated.View>

          <View style={styles.stats}>
            <Stat value={activeTrips.length} label="Upcoming" tone="info" />
            <View style={styles.statDivider} />
            <Stat value={totals.done} label="Tasks done" tone="accent" />
            <View style={styles.statDivider} />
            <Stat value={totals.essentials} label="Essentials open" tone="warning" />
          </View>

          <ContinuePlanningCard />

          {laterTrips.length > 0 ? (
            <View style={styles.group}>
              <SectionHeader
                title="Also coming up"
                trailing={
                  <Button label="All trips" variant="ghost" size="sm" onPress={() => router.navigate('/trips')} />
                }
              />
              {laterTrips.slice(0, 3).map((trip, index) => (
                <Animated.View key={trip.id} entering={FadeInDown.delay(80 + index * 60).duration(280)}>
                  <TripCard trip={trip} today={today} />
                </Animated.View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <FirstTripCard />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    gap: spacing.sm,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xxs,
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  group: {
    gap: spacing.md,
  },
  firstTrip: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  firstTripContent: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  sectionList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay,
  },
});
