import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, ProgressBar } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { packingProgress } from '../model';
import { usePackingStore, useTripPacking } from '../packingStore';
import { PackingStatusLine } from './PackingParts';

/** Trip dashboard entry point to the packing list. */
export function PackingSummaryCard({ tripId }: { tripId: string }) {
  const packing = useTripPacking(tripId);
  useFocusEffect(
    useCallback(() => {
      void usePackingStore.getState().load(tripId);
    }, [tripId]),
  );

  const progress = packingProgress(packing.entries);
  const pending = packing.recommendations.filter((r) => r.status === 'pending').length;
  const toBuy = packing.purchases.filter((p) => p.status === 'needed').length;
  const extras = [
    pending ? `${pending} ${pending === 1 ? 'suggestion' : 'suggestions'} to review` : '',
    toBuy ? `${toBuy} to buy` : '',
    packing.luggage.length ? `${packing.luggage.length} ${packing.luggage.length === 1 ? 'bag' : 'bags'}` : '',
  ].filter(Boolean);

  return (
    <Card
      onPress={() => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId } })}
      accessibilityLabel="Open packing list"
      testID="packing-summary"
    >
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name="bag-personal-outline" tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">Packing</AppText>
          <AppText variant="caption" tone="textMuted">
            {progress.entries === 0
              ? 'Nothing on the list yet — add from your inventory or get suggestions'
              : `${progress.packedUnits} of ${progress.units} packed`}
          </AppText>
        </View>
        <Icon name="chevron-right" tone="textMuted" />
      </View>
      {progress.units > 0 ? (
        <View style={styles.progress}>
          <ProgressBar value={progress.packedUnits / progress.units} height={4} />
        </View>
      ) : null}
      {packing.state && progress.entries > 0 ? <PackingStatusLine confirmed={Boolean(packing.state.confirmedAt)} /> : null}
      {extras.length > 0 ? (
        <AppText variant="caption" tone="warning" style={styles.extras}>
          {extras.join(' · ')}
        </AppText>
      ) : null}
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
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
  },
  progress: {
    marginVertical: spacing.sm,
  },
  extras: {
    marginTop: spacing.xs,
  },
});
