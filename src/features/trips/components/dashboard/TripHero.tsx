import { StyleSheet, View } from 'react-native';

import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import { AppText, Icon } from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { colors, radii, spacing, withAlpha } from '@/theme';

import { TripCover } from '../../../covers/TripCover';
import { describeTravellers, formatRoute, TRIP_CATEGORY_META, tripDays, type TripSummary } from '../../model';

/**
 * Compact trip header: the cover photo when one is found, otherwise a quiet layered
 * backdrop (never an empty photo frame or a photo error). Dates, length, travellers,
 * trip type and the route sit on top.
 */
export function TripHero({ trip }: { trip: TripSummary }) {
  const days = tripDays(trip);
  const category = TRIP_CATEGORY_META[trip.category];
  return (
    <View style={styles.frame} testID="trip-hero">
      <View style={[StyleSheet.absoluteFill, styles.fallback]} testID="trip-hero-fallback">
        <View style={styles.glowA} />
        <View style={styles.glowB} />
        <TopoBackdrop opacity={0.35} />
      </View>
      {trip.destinations.length > 0 ? <TripCover trip={trip} style={StyleSheet.absoluteFill} creditAtTop hideWhenMissing /> : null}
      <View style={styles.band} pointerEvents="none">
        <View style={styles.row}>
          <Icon name="calendar-range" size={16} color={colors.textPrimary} />
          <AppText variant="bodyStrong" style={styles.onPhoto} testID="trip-hero-dates">
            {formatDateRange(trip.startDate, trip.endDate)} · {days} {days === 1 ? 'day' : 'days'}
          </AppText>
        </View>
        <View style={styles.row}>
          <Icon name="account-group-outline" size={14} color={colors.textSecondary} />
          <AppText variant="caption" style={styles.onPhotoMuted} numberOfLines={1}>
            {describeTravellers(trip.travellers)}
            {category ? ` · ${category.label}` : ''}
          </AppText>
        </View>
        <View style={styles.row}>
          <Icon name="map-marker-path" size={14} color={colors.textSecondary} />
          <AppText variant="caption" numberOfLines={1} style={[styles.onPhotoMuted, styles.flex]} testID="trip-hero-route">
            {trip.destinations.length ? formatRoute(trip.destinations) : 'No destinations yet'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 148,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
  fallback: {
    backgroundColor: colors.surface,
  },
  glowA: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -140,
    right: -60,
    backgroundColor: withAlpha(colors.accent, 0.16),
  },
  glowB: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: -150,
    left: -40,
    backgroundColor: withAlpha(colors.info, 0.14),
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
