import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, IconButton, Tag } from '@/components/ui';
import { formatDateRange, type ISODate } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import {
  describeTripTiming,
  formatRoute,
  getTripLifecycle,
  getTripPhase,
  TRANSPORT_MODE_META,
  type TripSummary,
} from '../model';
import { ReadinessMeter } from './ReadinessMeter';

export interface TripCardProps {
  trip: TripSummary;
  today: ISODate;
  /** Opens the trip's management actions; omit to hide the menu button. */
  onMore?: (trip: TripSummary) => void;
}

export function TripCard({ trip, today, onMore }: TripCardProps) {
  const phase = getTripPhase(trip, today);
  const lifecycle = getTripLifecycle(trip);
  const transport = TRANSPORT_MODE_META[trip.transportMode];
  const timing = describeTripTiming(trip, today);
  const route = formatRoute(trip.destinations);
  const tag =
    lifecycle === 'archived'
      ? { label: 'Archived', color: colors.textMuted }
      : lifecycle === 'completed'
        ? { label: 'Completed', color: colors.accent }
        : phase === 'ongoing'
          ? { label: timing, color: colors.accent }
          : phase === 'ended'
            ? { label: 'Ended', color: colors.warning }
            : { label: timing, color: colors.info };

  return (
    <Card
      onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: trip.id } })}
      accessibilityLabel={`${trip.name}, ${route}, ${formatDateRange(trip.startDate, trip.endDate)}, ${tag.label}`}
      accessibilityHint="Opens the trip preparation dashboard"
      testID={`trip-card-${trip.id}`}
    >
      <View style={styles.top}>
        <View style={styles.iconBadge}>
          <Icon name={transport.icon} tone="accent" />
        </View>
        <View style={styles.titles}>
          <AppText variant="h3" numberOfLines={1}>
            {trip.name}
          </AppText>
          <View style={styles.line}>
            <Icon name="map-marker-path" size={14} tone="textMuted" />
            <AppText variant="caption" tone="textSecondary" numberOfLines={1} style={styles.flex}>
              {route}
            </AppText>
          </View>
          <View style={styles.line}>
            <Icon name="calendar-range" size={14} tone="textMuted" />
            <AppText variant="caption" tone="textMuted" numberOfLines={1} style={styles.flex}>
              {formatDateRange(trip.startDate, trip.endDate)}
            </AppText>
          </View>
        </View>
        {onMore ? (
          <IconButton
            icon="dots-vertical"
            variant="plain"
            tone="textSecondary"
            accessibilityLabel={`Manage ${trip.name}`}
            onPress={() => onMore(trip)}
            testID={`trip-more-${trip.id}`}
          />
        ) : null}
      </View>
      <View style={styles.tagRow}>
        <Tag label={tag.label} color={tag.color} />
        {lifecycle === 'active' && phase === 'ended' ? (
          <AppText variant="caption" tone="textMuted" style={styles.flex}>
            Mark it completed from the menu when you are back.
          </AppText>
        ) : null}
      </View>
      <View style={styles.meter}>
        <ReadinessMeter readiness={trip.readiness} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  meter: {
    marginTop: spacing.md,
  },
});
