import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, Tag } from '@/components/ui';
import { formatDateRange, type ISODate } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import {
  describeTripTiming,
  getTripPhase,
  TRANSPORT_MODE_META,
  type TripSummary,
} from '../model';
import { ReadinessMeter } from './ReadinessMeter';

export interface TripCardProps {
  trip: TripSummary;
  today: ISODate;
}

export function TripCard({ trip, today }: TripCardProps) {
  const phase = getTripPhase(trip, today);
  const transport = TRANSPORT_MODE_META[trip.transportMode];
  const timing = describeTripTiming(trip, today);
  const timingColor =
    phase === 'ongoing' ? colors.accent : phase === 'completed' ? colors.textMuted : colors.info;

  return (
    <Card
      onPress={() => router.push({ pathname: '/trips/[tripId]', params: { tripId: trip.id } })}
      accessibilityLabel={`${trip.name}, ${trip.destination}, ${formatDateRange(trip.startDate, trip.endDate)}, ${timing}`}
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
          <View style={styles.destination}>
            <Icon name="map-marker-outline" size={14} tone="textMuted" />
            <AppText variant="caption" tone="textSecondary" numberOfLines={1} style={styles.flex}>
              {trip.destination} · {formatDateRange(trip.startDate, trip.endDate)}
            </AppText>
          </View>
        </View>
        <Tag label={timing} color={timingColor} />
      </View>
      <View style={styles.meter}>
        <ReadinessMeter progress={trip.progress} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
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
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  meter: {
    marginTop: spacing.lg,
  },
});
