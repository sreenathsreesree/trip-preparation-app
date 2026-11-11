import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { formatRoute } from '../../trips/model';
import { selectTripById, useTripsStore } from '../../trips/tripsStore';
import { usePlannerStore } from '../plannerStore';

/** Home shortcut back into the most recently opened trip planner. */
export function ContinuePlanningCard() {
  const tripId = usePlannerStore((state) => state.lastOpenedTripId);
  const trip = useTripsStore(selectTripById(tripId ?? undefined));
  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().loadLastOpened();
    }, []),
  );
  if (!trip || trip.archivedAt || trip.completedAt) return null;

  return (
    <Card
      onPress={() => router.push({ pathname: '/trips/[tripId]/plan', params: { tripId: trip.id } })}
      accessibilityLabel={`Continue planning ${trip.name}`}
      testID="home-continue-planning"
    >
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name="map-search-outline" tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="label" tone="accent">
            Continue planning
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {trip.name}
          </AppText>
          <AppText variant="caption" tone="textMuted" numberOfLines={1}>
            {formatRoute(trip.destinations)}
          </AppText>
        </View>
        <Icon name="chevron-right" tone="textMuted" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
