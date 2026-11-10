import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Notice,
  ProgressBar,
  Tag,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../../trips/hooks';
import type { TripSummary } from '../../trips/model';
import { useChecklistStore } from '../checklistStore';
import { useOwner, useOwnerChecklist } from '../hooks';
import { emptyTaskDraft, SECTION_META, sortByPosition, type ChecklistTask } from '../model';
import { completionPercent, computeStats, openCount } from '../readiness';
import { AddItemBar } from './AddItemBar';
import { TaskRow } from './TaskRow';

function SectionBody({ trip, sectionId }: { trip: TripSummary; sectionId: string }) {
  const owner = useOwner('trip', trip.id);
  const checklist = useOwnerChecklist(owner);
  const { load, addTask, toggleTask, deleteTask, moveTask } = useChecklistStore.getState();
  const [actionError, setActionError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const section = checklist.sections.find((s) => s.id === sectionId);
  if (!owner) return null;

  if (checklist.status === 'ready' && !section) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Section" />
        <EmptyState
          icon="clipboard-alert-outline"
          title="Section not found"
          message="It may have been deleted."
          action={{
            label: 'Back to trip',
            onPress: () => router.replace({ pathname: '/trips/[tripId]', params: { tripId: trip.id } }),
          }}
        />
      </Screen>
    );
  }

  const meta = SECTION_META[section?.kind ?? 'custom'];
  const tasks = sortByPosition(checklist.tasks.filter((task) => task.sectionId === sectionId));
  const open = tasks.filter((task) => !task.isDone);
  const done = tasks.filter((task) => task.isDone);
  const stats = computeStats(tasks);
  const essentialsOpen = openCount(stats.essential);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setActionError(null);
    fn().catch((error: unknown) => setActionError(toErrorMessage(error, fallback)));
  };

  const openTask = (task: ChecklistTask) =>
    router.push({ pathname: '/trips/[tripId]/tasks/[taskId]', params: { tripId: trip.id, taskId: task.id } });

  const row = (task: ChecklistTask, index?: number) => (
    <TaskRow
      key={task.id}
      task={task}
      tint={meta.tint}
      onToggle={(t) => run(() => toggleTask(owner, t.id), 'Could not update the task.')}
      onOpen={openTask}
      onDelete={(t) => run(() => deleteTask(owner, t.id), 'Could not delete the task.')}
      reorder={
        reordering && index !== undefined
          ? {
              canMoveUp: index > 0,
              canMoveDown: index < tasks.length - 1,
              onMove: (direction) => run(() => moveTask(owner, task.id, direction), 'Could not move the task.'),
            }
          : undefined
      }
    />
  );

  return (
    <Screen testID={`section-screen-${section?.kind === 'custom' ? 'custom' : (section?.kind ?? 'loading')}`} bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title={section?.title ?? 'Checklist'}
        subtitle={section && section.kind !== 'custom' ? meta.description : undefined}
        trailing={
          tasks.length > 1 ? (
            <Button
              label={reordering ? 'Done' : 'Reorder'}
              icon={reordering ? 'check' : 'swap-vertical'}
              variant={reordering ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setReordering((value) => !value)}
              testID="toggle-reorder"
            />
          ) : undefined
        }
      />

      <View style={styles.progress}>
        <View style={styles.progressRow}>
          <View style={styles.flex}>
            <ProgressBar
              value={completionPercent(stats) / 100}
              color={meta.tint}
              accessibilityLabel={`${stats.done} of ${stats.total} done`}
            />
          </View>
          <AppText variant="captionStrong" tone="textSecondary" testID="section-progress-text">
            {stats.done}/{stats.total} done
          </AppText>
        </View>
        {essentialsOpen > 0 ? (
          <Tag icon="alert-decagram" label={`${essentialsOpen} essential still open`} color={colors.danger} />
        ) : null}
      </View>

      {reordering ? null : (
        <AddItemBar
          placeholder={meta.addPlaceholder}
          withPriority
          onAdd={(title, priority) => addTask(owner, sectionId, { ...emptyTaskDraft(priority), title })}
        />
      )}

      {actionError ? <Notice tone="danger" title="Something went wrong" message={actionError} /> : null}

      {checklist.status === 'error' ? (
        <ErrorState message={checklist.error ?? 'Could not load this checklist.'} onRetry={() => void load(owner)} />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading checklist…" />
      ) : tasks.length === 0 ? (
        <EmptyState icon={meta.icon} title="Nothing here yet" message="Add your first task using the field above." />
      ) : reordering ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textMuted">
            Use the arrows to change the order
          </AppText>
          {tasks.map((task, index) => row(task, index))}
        </View>
      ) : (
        <View style={styles.groups}>
          {open.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textMuted">
                To do · {open.length}
              </AppText>
              {open.map((task) => row(task))}
            </View>
          ) : (
            <View style={styles.allDone}>
              <Icon name="check-decagram" tone="accent" />
              <AppText variant="bodyStrong" tone="accent" style={styles.flex}>
                Everything in {section?.title ?? 'this section'} is done.
              </AppText>
            </View>
          )}
          {done.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textMuted">
                Done · {done.length}
              </AppText>
              {done.map((task) => row(task))}
            </View>
          ) : null}
          <AppText variant="caption" tone="textMuted" align="center">
            Tap a task to edit details · swipe left to delete
          </AppText>
        </View>
      )}
    </Screen>
  );
}

export function TripSectionScreen({
  tripId,
  sectionId,
}: {
  tripId: string | undefined;
  sectionId: string | undefined;
}) {
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip && sectionId) return <SectionBody trip={trip} sectionId={sectionId} />;

  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Checklist" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="clipboard-alert-outline"
          title="Checklist not found"
          message="This trip may have been deleted from this device."
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
  progress: {
    gap: spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
