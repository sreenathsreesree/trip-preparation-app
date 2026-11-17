import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, ErrorState, LoadingState, ProgressBar } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { useOwner, useOwnerChecklist } from '../../../preparation/hooks';
import { usePackingStore, useTripPacking } from '../../../packing/packingStore';
import { preparationProgress } from '../../../preparation/readiness';

/**
 * Journey readiness: the overall preparation figure only. Every task, section and tool lives in
 * the Checklist tab; this card opens it on this trip.
 */
export function ReadinessSummary({ tripId }: { tripId: string }) {
  const owner = useOwner('trip', tripId);
  const checklist = useOwnerChecklist(owner);
  const packing = useTripPacking(tripId);
  useFocusEffect(
    useCallback(() => {
      void usePackingStore.getState().load(tripId);
    }, [tripId]),
  );
  // Checklist tasks plus packing items, each counted once.
  const progress = preparationProgress(checklist.tasks, packing.entries);
  const open = () => router.push({ pathname: '/checklists', params: { trip: tripId } });
  return (
    <Card testID="readiness-summary">
      <View style={styles.group}>
        <AppText variant="label" tone="textMuted">
          Journey readiness
        </AppText>
        {checklist.status === 'error' ? (
          <ErrorState message={checklist.error ?? 'Could not load the checklist.'} />
        ) : checklist.status !== 'ready' ? (
          <LoadingState label="Loading preparation…" />
        ) : (
          <>
            <View style={styles.row}>
              <AppText variant="metric" style={{ color: progress.percent === 100 ? colors.accent : colors.textPrimary }} testID="completion-percent">
                {progress.percent}%
              </AppText>
              <AppText variant="body" tone="textSecondary" style={styles.flex} testID="readiness-count">
                {progress.total === 0 ? 'Nothing to prepare yet' : `${progress.done} of ${progress.total} done`}
              </AppText>
            </View>
            <ProgressBar value={progress.percent / 100} height={6} accessibilityLabel={`${progress.done} of ${progress.total} preparation tasks and packing items done`} />
            <AppText variant="caption" tone="textMuted" testID="readiness-parts">
              Checklist {progress.tasks.done}/{progress.tasks.total} · Packing {progress.packing.done}/{progress.packing.total} packed
            </AppText>
          </>
        )}
        <Button label="Open preparation checklist" icon="clipboard-check-outline" variant="secondary" size="sm" onPress={open} style={styles.left} testID="open-checklist" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  flex: { flex: 1 },
  left: { alignSelf: 'flex-start' },
});
