import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { formatRoute, type TripSummary } from '../../trips/model';
import { usePlannerStore, useTripPlan } from '../plannerStore';

/** Trip dashboard entry point to the destination planner. */
export function PlanSummaryCard({ trip }: { trip: TripSummary }) {
  const { plan } = useTripPlan(trip.id);
  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().load(trip.id);
    }, [trip.id]),
  );
  const open = () => router.push({ pathname: '/trips/[tripId]/plan', params: { tripId: trip.id } });
  const empty = trip.destinations.length === 0;
  const places = plan?.nodes.length ?? 0;
  const nested = places - trip.destinations.length;
  const stops = plan?.route.length ?? 0;

  return (
    <Card variant={empty ? 'accent' : 'default'} testID="plan-summary">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name="map-search-outline" tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">Destinations</AppText>
          <AppText variant={empty ? 'caption' : 'bodyStrong'} tone={empty ? 'textSecondary' : 'textPrimary'} numberOfLines={3}>
            {empty ? 'Plan where you are going: main destinations, places to see inside them, and your route.' : formatRoute(trip.destinations)}
          </AppText>
          {!empty && plan ? (
            <AppText variant="caption" tone="textMuted">
              {nested > 0 ? `${nested} ${nested === 1 ? 'place' : 'places'} inside · ` : ''}
              {stops} route {stops === 1 ? 'stop' : 'stops'}
            </AppText>
          ) : null}
        </View>
      </View>
      <Button
        label={empty ? 'Start planning' : 'Plan destinations'}
        icon="map-marker-plus-outline"
        variant={empty ? 'primary' : 'secondary'}
        size="sm"
        onPress={open}
        style={styles.button}
        testID="plan-destinations"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
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
    gap: spacing.xxs,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
