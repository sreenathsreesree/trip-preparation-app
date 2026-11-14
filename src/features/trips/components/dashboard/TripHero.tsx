import { StyleSheet, View } from 'react-native';

import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import { AppText, Icon } from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import { TripCover } from '../../../covers/TripCover';
import { formatRoute, type TripSummary } from '../../model';

/** Scenic trip header: the cover photo (or a quiet backdrop) with dates and route over it. */
export function TripHero({ trip }: { trip: TripSummary }) {
  const hasCover = trip.destinations.length > 0;
  return (
    <View style={styles.frame} testID="trip-hero">
      {hasCover ? <TripCover trip={trip} style={StyleSheet.absoluteFill} creditAtTop /> : <TopoBackdrop opacity={0.5} />}
      <View style={styles.band} pointerEvents="none">
        <View style={styles.row}>
          <Icon name="calendar-range" size={16} color={colors.textPrimary} />
          <AppText variant="bodyStrong" style={styles.onPhoto}>
            {formatDateRange(trip.startDate, trip.endDate)}
          </AppText>
        </View>
        <View style={styles.row}>
          <Icon name="map-marker-path" size={16} color={colors.textSecondary} />
          <AppText variant="caption" numberOfLines={1} style={[styles.onPhotoMuted, styles.flex]}>
            {trip.destinations.length ? formatRoute(trip.destinations) : 'No destinations yet'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 190,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.xxs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.photoChrome,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  onPhoto: {
    color: colors.textPrimary,
  },
  onPhotoMuted: {
    color: colors.textSecondary,
  },
});
