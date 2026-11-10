import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  ProgressBar,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../../trips/hooks';
import type { TripSummary } from '../../trips/model';
import {
  getApplicableSections,
  isPrepSectionId,
  PREP_SECTION_META,
  summarizeItems,
  type PrepItem,
  type PrepSectionId,
} from '../model';
import { usePrepStore, useTripChecklist } from '../prepStore';
import { AddItemBar } from './AddItemBar';
import { PrepItemRow } from './PrepItemRow';

function ChecklistBody({ trip, section }: { trip: TripSummary; section: PrepSectionId }) {
  const meta = PREP_SECTION_META[section];
  const checklist = useTripChecklist(trip.id);
  const { loadTrip, addItem, toggleItem, removeItem } = usePrepStore.getState();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (checklist.status === 'idle') void loadTrip(trip.id);
  }, [checklist.status, trip.id, loadTrip]);

  const items = checklist.items
    .filter((item) => item.section === section)
    .sort((a, b) => a.position - b.position);
  const open = items.filter((item) => !item.isDone);
  const done = items.filter((item) => item.isDone);
  const progress = summarizeItems(items);

  async function run(action: () => Promise<void>, fallback: string) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(toErrorMessage(error, fallback));
    }
  }

  const renderItem = (item: PrepItem) => (
    <PrepItemRow
      key={item.id}
      item={item}
      tint={meta.tint}
      onToggle={(target) => void run(() => toggleItem(trip.id, target.id), 'Could not update the item.')}
      onDelete={(target) => void run(() => removeItem(trip.id, target.id), 'Could not delete the item.')}
    />
  );

  return (
    <Screen testID={`section-screen-${section}`}>
      <ScreenHeader showBack eyebrow={trip.name} title={meta.title} subtitle={meta.description} />

      <View style={styles.progressRow}>
        <View style={styles.flex}>
          <ProgressBar
            value={progress.total === 0 ? 0 : progress.done / progress.total}
            color={meta.tint}
            accessibilityLabel={`${progress.done} of ${progress.total} ready`}
          />
        </View>
        <AppText variant="captionStrong" tone="textSecondary" testID="section-progress-text">
          {progress.done}/{progress.total} ready
        </AppText>
      </View>

      <AddItemBar
        placeholder={meta.addPlaceholder}
        onAdd={(title) => addItem(trip.id, section, title)}
      />

      {actionError ? (
        <View style={styles.errorRow} accessibilityRole="alert">
          <Icon name="alert-circle-outline" tone="danger" size={16} />
          <AppText variant="caption" tone="danger" style={styles.flex}>
            {actionError}
          </AppText>
        </View>
      ) : null}

      {checklist.status === 'error' ? (
        <ErrorState
          message={checklist.error ?? 'Could not load this checklist.'}
          onRetry={() => void loadTrip(trip.id)}
        />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading checklist…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title="Nothing here yet"
          message="Add your first item using the field above."
        />
      ) : (
        <View style={styles.groups}>
          {open.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textMuted">
                To do · {open.length}
              </AppText>
              {open.map(renderItem)}
            </View>
          ) : (
            <View style={styles.allDone}>
              <Icon name="check-decagram" tone="accent" />
              <AppText variant="bodyStrong" tone="accent">
                Everything in {meta.title.toLowerCase()} is ready.
              </AppText>
            </View>
          )}
          {done.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textMuted">
                Done · {done.length}
              </AppText>
              {done.map(renderItem)}
            </View>
          ) : null}
          <AppText variant="caption" tone="textMuted" align="center">
            Tip: swipe an item left to delete it.
          </AppText>
        </View>
      )}
    </Screen>
  );
}

export function SectionChecklist({
  tripId,
  section,
}: {
  tripId: string | undefined;
  section: string | undefined;
}) {
  const { trip, status, error, reload } = useTrip(tripId);

  if (trip && isPrepSectionId(section) && getApplicableSections(trip.transportMode).includes(section)) {
    return <ChecklistBody trip={trip} section={section} />;
  }

  return (
    <Screen>
      <ScreenHeader showBack title="Checklist" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="clipboard-alert-outline"
          title="Checklist not found"
          message={
            trip
              ? 'This section does not apply to this trip.'
              : 'This trip may have been deleted from this device.'
          }
          action={{ label: 'View all trips', onPress: () => router.replace('/trips') }}
        />
      ) : (
        <LoadingState label="Loading checklist…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  groups: {
    gap: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  allDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
});
