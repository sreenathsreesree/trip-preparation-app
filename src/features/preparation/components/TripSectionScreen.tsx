import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  ActionSheet,
  AppText,
  Button,
  Collapsible,
  IconButton,
  MiniStepper,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Notice,
  ProgressBar,
  Tag,
  type SheetAction,
} from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../../trips/hooks';
import type { TripSummary } from '../../trips/model';
import { useChecklistStore } from '../checklistStore';
import { useOwner, useOwnerChecklist } from '../hooks';
import { emptyTaskDraft, SECTION_META, sortByPosition, type ChecklistTask } from '../model';
import { completionPercent, computeStats, openCount } from '../readiness';
import { AddItemBar } from './AddItemBar';
import { holdsItems, isClothingSection, isOldPackingSection } from '../sectionExtrasRepository';
import { useSectionSettingsStore } from '../sectionSettingsStore';
import { SectionArrangeList, type TaskReorder } from './SectionArrangeList';
import { useSectionExtras, useSectionExtrasStore } from '../sectionExtrasStore';
import { CategoryShortcut, GroupChips, GroupsManager, InventoryPicker } from './SectionTools';
import { TaskRow } from './TaskRow';

function SectionBody({ trip, sectionId }: { trip: TripSummary; sectionId: string }) {
  const owner = useOwner('trip', trip.id);
  const checklist = useOwnerChecklist(owner);
  const { load, addTask, toggleTask, deleteTask } = useChecklistStore.getState();
  const [actionError, setActionError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const extras = useSectionExtras(sectionId);
  const [addGroup, setAddGroup] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moving, setMoving] = useState<ChecklistTask | null>(null);
  const [menuFor, setMenuFor] = useState<ChecklistTask | null>(null);
  const [relocating, setRelocating] = useState<ChecklistTask | null>(null);
  const ownSettings = useSectionSettingsStore((s) => s.bySection[sectionId] ?? null);
  useEffect(() => {
    void useSectionExtrasStore.getState().load(sectionId);
    void useSectionSettingsStore.getState().load([sectionId]);
  }, [sectionId]);

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

  const groupIds = new Set(extras.groups.map((g) => g.id));
  const groupOf = (task: ChecklistTask) => {
    const g = extras.links[task.id]?.groupId ?? null;
    return g && groupIds.has(g) ? g : null;
  };
  const row = (task: ChecklistTask, reorder?: TaskReorder) => {
    const link = extras.links[task.id];
    const fromInventory = Boolean(link?.inventoryItemId);
    return (
      <View key={task.id} style={styles.taskLine}>
        <View style={styles.flex}>
          <TaskRow
            task={task}
            tint={meta.tint}
            context={fromInventory ? `From Inventory · ×${link?.quantity ?? 1}` : undefined}
            onToggle={(t) => run(() => toggleTask(owner, t.id), 'Could not update the task.')}
            onOpen={openTask}
            onDelete={(t) => run(() => deleteTask(owner, t.id), 'Could not delete the task.')}
            reorder={reordering ? reorder : undefined}
          />
        </View>
        {!reordering && fromInventory ? (
          <MiniStepper label={`Quantity of ${task.title}`} value={link?.quantity ?? 1} min={1} max={99} onChange={(q) => run(() => useSectionExtrasStore.getState().setQuantity(sectionId, task.id, q), 'Could not change the quantity.')} testID={`task-qty-${task.title}`} />
        ) : null}
        {!reordering ? (
          <IconButton icon="dots-vertical" size="sm" variant="plain" accessibilityLabel={`${task.title} options`} onPress={() => setMenuFor(task)} testID={`task-menu-${task.title}`} />
        ) : null}
      </View>
    );
  };

  const otherSections = checklist.sections.filter((s) => s.id !== sectionId && !isOldPackingSection(s));

  async function moveToSection(task: ChecklistTask, targetId: string) {
    const { sectionExtras } = await getRepositories();
    const clash = await sectionExtras.linkConflict(task.id, targetId);
    if (clash) throw new Error(`“${clash}” from your Inventory is already in that section.`);
    await useChecklistStore.getState().updateTask(owner!, task.id, { title: task.title, description: task.description, notes: task.notes, priority: task.priority }, { sectionId: targetId });
    // It arrives outside any group of the new section.
    await useSectionExtrasStore.getState().setTaskGroup(targetId, task.id, null);
    await useSectionExtrasStore.getState().load(sectionId);
    const target = checklist.sections.find((s) => s.id === targetId);
    setMessage(`Moved “${task.title}” to ${target?.title ?? 'the other section'}.`);
  }

  async function removeTask(task: ChecklistTask) {
    const ok = await confirmAction({
      title: 'Remove this task from the trip?',
      message: `“${task.title}” is deleted from this checklist.${extras.links[task.id]?.inventoryItemId ? ' The Inventory item it came from is not touched.' : ''}`,
      confirmLabel: 'Remove task',
      destructive: true,
    });
    if (ok) run(() => deleteTask(owner!, task.id), 'Could not delete the task.');
  }

  const taskMenu = (task: ChecklistTask): SheetAction[] => [
    { key: 'edit', label: 'Edit details', icon: 'pencil-outline', onPress: () => { setMenuFor(null); openTask(task); } },
    ...(extras.groups.length > 0 ? [{ key: 'group', label: 'Move to a group', icon: 'folder-move-outline' as const, onPress: () => { setMenuFor(null); setMoving(task); } }] : []),
    ...(otherSections.length > 0 ? [{ key: 'section', label: 'Move to another section', icon: 'arrow-right' as const, onPress: () => { setMenuFor(null); setRelocating(task); } }] : []),
    { key: 'delete', label: 'Remove from this trip', icon: 'trash-can-outline', destructive: true, onPress: () => { setMenuFor(null); void removeTask(task); } },
  ];

  /** Open and done tasks under one heading. */
  const block = (key: string, title: string | null, list: ChecklistTask[]) => {
    const openList = list.filter((t) => !t.isDone);
    const doneList = list.filter((t) => t.isDone);
    return (
      <View key={key} style={styles.group} testID={`section-group-block-${title ?? 'none'}`}>
        {title ? (
          <AppText variant="title" numberOfLines={1}>
            {title}
          </AppText>
        ) : null}
        {list.length === 0 ? (
          <AppText variant="caption" tone="textMuted">
            Nothing in this group yet.
          </AppText>
        ) : null}
        {openList.length > 0 ? (
          <View style={styles.group}>
            <AppText variant="label" tone="textMuted">
              To do · {openList.length}
            </AppText>
            {openList.map((task) => row(task))}
          </View>
        ) : null}
        {doneList.length > 0 ? (
          <View style={styles.group}>
            <AppText variant="label" tone="textMuted">
              Done · {doneList.length}
            </AppText>
            {doneList.map((task) => row(task))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen testID={`section-screen-${section?.kind === 'custom' ? 'custom' : (section?.kind ?? 'loading')}`} bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title={section?.title ?? 'Checklist'}
        subtitle={section && section.kind !== 'custom' ? meta.description : undefined}
        trailing={
          tasks.length > 1 || extras.groups.length > 1 ? (
            <Button
              label={reordering ? 'Done' : 'Arrange'}
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

      {section ? <CategoryShortcut tripId={trip.id} section={section} /> : null}

      {section && isOldPackingSection(section) ? (
        <Notice
          tone="info"
          icon="bag-suitcase-outline"
          title="Packing now lives in the Packing list"
          message="Add new packing items there. These remaining tasks can be moved, kept or removed from Packing → “From your old checklist”."
          action={{ label: 'Open Packing', icon: 'bag-suitcase-outline', onPress: () => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId: trip.id } }) }}
          testID="section-old-packing"
        />
      ) : null}

      {reordering || (section && isOldPackingSection(section)) ? null : (
        <View style={styles.group}>
          <GroupChips groups={extras.groups} value={addGroup && groupIds.has(addGroup) ? addGroup : null} onChange={setAddGroup} />
          <AddItemBar
            placeholder={meta.addPlaceholder}
            withPriority
            onAdd={(title, priority) => {
              const g = addGroup && groupIds.has(addGroup) ? addGroup : null;
              return g ? useSectionExtrasStore.getState().addManual(owner, sectionId, g, title, priority) : addTask(owner, sectionId, { ...emptyTaskDraft(priority), title });
            }}
          />
          {section && holdsItems(section, ownSettings) ? (
            <Button
              label={picking ? 'Close Inventory' : 'Add from Inventory'}
              icon="archive-arrow-down-outline"
              variant="secondary"
              size="sm"
              onPress={() => setPicking((v) => !v)}
              style={styles.left}
              testID="section-add-from-inventory"
            />
          ) : null}
          {picking && section ? (
            <InventoryPicker
              owner={owner}
              section={section}
              groupId={addGroup && groupIds.has(addGroup) ? addGroup : null}
              onDone={(m) => {
                setMessage(m);
                setPicking(false);
              }}
            />
          ) : null}
          {message ? <Notice tone="success" title={message} testID="section-message" /> : null}
          <Collapsible
            title="Groups in this section"
            icon="folder-multiple-outline"
            summary={extras.groups.length ? extras.groups.map((g) => g.title).join(', ') : 'Create groups such as Tops, Trousers or Footwear'}
            initiallyOpen={Boolean(section && isClothingSection(section) && extras.status === 'ready' && extras.groups.length === 0)}
            key={`groups-${extras.status}`}
            testID="section-groups-section"
          >
            <GroupsManager sectionId={sectionId} />
          </Collapsible>
        </View>
      )}

      {actionError ? <Notice tone="danger" title="Something went wrong" message={actionError} /> : null}

      {checklist.status === 'error' ? (
        <ErrorState message={checklist.error ?? 'Could not load this checklist.'} onRetry={() => void load(owner)} />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading checklist…" />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title="Nothing here yet"
          message={section && holdsItems(section, ownSettings) ? 'Add a task above, or add things you own with Add from Inventory.' : 'Add your first task using the field above.'}
        />
      ) : reordering ? (
        <SectionArrangeList
          groups={extras.groups}
          tasks={tasks}
          groupOf={groupOf}
          onArrange={(layout) => run(() => useSectionExtrasStore.getState().arrangeSection(owner, sectionId, layout), 'Could not move it.')}
          renderTask={(task, reorder) => row(task, reorder)}
        />
      ) : (
        <View style={styles.groups}>
          {extras.groups.length > 0 ? (
            <>
              {extras.groups.map((g) => block(g.id, g.title, tasks.filter((t) => groupOf(t) === g.id)))}
              {tasks.some((t) => groupOf(t) === null) ? block('none', 'Not in a group', tasks.filter((t) => groupOf(t) === null)) : null}
            </>
          ) : (
            <>
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
            </>
          )}
          <AppText variant="caption" tone="textMuted" align="center">
            Tap a task to edit details · swipe left to delete
          </AppText>
        </View>
      )}
      <ActionSheet
        visible={moving !== null}
        title={moving ? `Move “${moving.title}” to` : ''}
        actions={[
          ...extras.groups.map((g) => ({ key: g.id, label: g.title, icon: 'folder-outline' as const, onPress: () => { const t = moving; setMoving(null); if (t) run(() => useSectionExtrasStore.getState().setTaskGroup(sectionId, t.id, g.id), 'Could not move it.'); } })),
          { key: 'none', label: 'No group', icon: 'tray' as const, onPress: () => { const t = moving; setMoving(null); if (t) run(() => useSectionExtrasStore.getState().setTaskGroup(sectionId, t.id, null), 'Could not move it.'); } },
        ]}
        onClose={() => setMoving(null)}
        testID="task-move-sheet"
      />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.title ?? ''}
        actions={menuFor ? taskMenu(menuFor) : []}
        onClose={() => setMenuFor(null)}
        testID="task-menu-sheet"
      />
      <ActionSheet
        visible={relocating !== null}
        title={relocating ? `Move “${relocating.title}” to another section` : ''}
        actions={otherSections.map((target) => ({
          key: target.id,
          label: target.title,
          icon: 'arrow-right' as const,
          onPress: () => {
            const t = relocating;
            setRelocating(null);
            if (t) run(() => moveToSection(t, target.id), 'Could not move it.');
          },
        }))}
        onClose={() => setRelocating(null)}
        testID="task-section-sheet"
      />
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
  taskLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  left: {
    alignSelf: 'flex-start',
  },
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
