import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { spacing } from '@/theme';

import { formatRoute } from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import { selectTripById, useTripsStore } from '../../tripsStore';

/**
 * Destinations live in the planner (one destination system). The trip form
 * links there instead of editing a separate list.
 */
export function DestinationsPlannerLink() {
  const mode = useTripDraftStore((state) => state.mode);
  const tripId = useTripDraftStore((state) => state.tripId);
  const trip = useTripsStore(selectTripById(tripId ?? undefined));

  return (
    <Card variant="outline" testID="destinations-planner-link">
      <View style={styles.row}>
        <Icon name="map-marker-path" tone="accent" />
        <View style={styles.text}>
          <AppText variant="label" tone="textSecondary">
            Destinations
          </AppText>
          {mode === 'edit' && trip ? (
            <AppText variant="bodyStrong" numberOfLines={3}>
              {formatRoute(trip.destinations)}
            </AppText>
          ) : (
            <AppText variant="caption" tone="textSecondary">
              Plan them right after creating the trip: main destinations, places inside them and your route. You can
              also save the trip before deciding.
            </AppText>
          )}
        </View>
      </View>
      {mode === 'edit' && tripId ? (
        <Button
          label="Edit destinations in the planner"
          icon="map-search-outline"
          variant="secondary"
          size="sm"
          onPress={() => router.push({ pathname: '/trips/[tripId]/plan', params: { tripId } })}
          style={styles.button}
          testID="edit-destinations-in-planner"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
