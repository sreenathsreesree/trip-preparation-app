import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { DestinationThumb } from '../../covers/DestinationThumb';
import type { TripSummary } from '../../trips/model';
import { routeNodes } from '../model';
import { usePlannerStore, useTripPlan } from '../plannerStore';

/**
 * The dashboard's main action: plan where the trip goes. Shows how many main
 * destinations and places inside them there are, and the route order.
 */
export function PlanSummaryCard({ trip }: { trip: TripSummary }) {
  const { plan } = useTripPlan(trip.id);
  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().load(trip.id);
    }, [trip.id]),
  );
  const open = () => router.push({ pathname: '/trips/[tripId]/plan', params: { tripId: trip.id } });
  const nodes = plan?.nodes ?? [];
  const mains = nodes.filter((n) => n.parentId === null).sort((a, b) => a.position - b.position);
  const empty = mains.length === 0 && trip.destinations.length === 0;
  const inside = nodes.length - mains.length;
  const route = plan ? routeNodes(plan).filter((n) => n.parentId === null) : [];
  const routeText = route.length > 0 ? route.map((n) => n.name).join(' → ') : null;
  const count = mains.length || trip.destinations.length;
  return (
    <Card variant="accent" testID="plan-summary">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name="map-search-outline" tone="accent" size={26} />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">{empty ? 'Plan your destinations' : 'Destinations'}</AppText>
          <AppText variant="caption" tone="textSecondary" testID="plan-summary-counts">
            {empty
              ? 'Add main destinations, the places to see inside them, and the order you’ll travel.'
              : [
                  `${count} ${count === 1 ? 'destination' : 'destinations'}`,
                  inside > 0 ? `${inside} ${inside === 1 ? 'place' : 'places'} inside` : null,
                  route.length > 0 ? `${route.length} on the route` : 'No route yet',
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </AppText>
        </View>
      </View>
      {mains.length > 0 ? (
        <View style={styles.thumbs}>
          {mains.slice(0, 5).map((n) => (
            <DestinationThumb key={n.id} tripId={trip.id} node={n} size={52} />
          ))}
          {mains.length > 5 ? (
            <View style={styles.more}>
              <AppText variant="captionStrong" tone="textSecondary">
                +{mains.length - 5}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
      {routeText ? (
        <View style={styles.route}>
          <Icon name="map-marker-path" size={16} tone="accent" />
          <AppText variant="body" numberOfLines={2} style={styles.flex} testID="plan-summary-route">
            {routeText}
          </AppText>
        </View>
      ) : null}
      <Button label={empty ? 'Start planning' : 'Plan destinations'} icon="map-marker-plus-outline" onPress={open} style={styles.button} testID="plan-destinations" />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  thumbs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  more: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    marginTop: spacing.md,
  },
});
