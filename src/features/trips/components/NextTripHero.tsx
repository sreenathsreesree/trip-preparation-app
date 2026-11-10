import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import { AppText, Button, Icon } from '@/components/ui';
import { diffInDays, formatDateRange, type ISODate } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import { formatRoute, getTripPhase, type TripSummary } from '../model';
import { ReadinessMeter } from './ReadinessMeter';
import { TripMetaTags } from './TripMetaTags';

function countdown(trip: TripSummary, today: ISODate): { value: string; caption: string } {
  const phase = getTripPhase(trip, today);
  if (phase === 'ongoing') {
    return { value: `Day ${diffInDays(trip.startDate, today) + 1}`, caption: 'On the road' };
  }
  const days = diffInDays(today, trip.startDate);
  return { value: String(days), caption: days === 1 ? 'day to go' : 'days to go' };
}

/** Home hero for the nearest upcoming or ongoing trip. */
export function NextTripHero({ trip, today }: { trip: TripSummary; today: ISODate }) {
  const { value, caption } = countdown(trip, today);
  const phase = getTripPhase(trip, today);

  return (
    <View style={styles.card} testID="next-trip-hero">
      <TopoBackdrop opacity={0.55} />
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.titles}>
            <AppText variant="label" tone="accent">
              {phase === 'ongoing' ? 'Current expedition' : 'Next expedition'}
            </AppText>
            <AppText variant="h2" numberOfLines={2}>
              {trip.name}
            </AppText>
            <View style={styles.destination}>
              <Icon name="map-marker" size={16} tone="info" />
              <AppText variant="captionStrong" tone="textSecondary" numberOfLines={2} style={styles.flex}>
                {formatRoute(trip.destinations)}
              </AppText>
            </View>
          </View>
          <View style={styles.countdown}>
            <AppText variant="metric" tone="accent">
              {value}
            </AppText>
            <AppText variant="label" tone="textMuted" align="center">
              {caption}
            </AppText>
          </View>
        </View>

        <View style={styles.dates}>
          <Icon name="calendar-range" size={16} tone="textMuted" />
          <AppText variant="caption" tone="textSecondary">
            {formatDateRange(trip.startDate, trip.endDate)}
          </AppText>
        </View>

        <TripMetaTags trip={trip} />
        <ReadinessMeter readiness={trip.readiness} size="large" />

        <Button
          label="Open preparation dashboard"
          icon="arrow-right"
          iconPosition="trailing"
          onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: trip.id } })}
          testID="hero-open-dashboard"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -60,
    top: -80,
    backgroundColor: colors.accentSoft,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  titles: {
    flex: 1,
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countdown: {
    alignItems: 'center',
    minWidth: 76,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.overlay,
  },
  dates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
