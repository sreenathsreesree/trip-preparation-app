import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { Screen } from '@/components/layout/Screen';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  MiniStepper,
  Notice,
  OptionTile,
  SearchField,
  TextField,
  ToggleRow,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { getRepositories } from '@/db/repositories';

import { useChecklistStore } from '../checklistStore';
import { holdsItems, isOldPackingSection, type TaskLink } from '../sectionExtrasRepository';
import { useSectionSettingsStore } from '../sectionSettingsStore';
import { useEnsureInventoryLoaded } from '../../inventory/hooks';
import { useInventoryStore } from '../../inventory/inventoryStore';
import { useSectionExtras, useSectionExtrasStore } from '../sectionExtrasStore';
import { useEnsureTemplatesLoaded, useOwner, useOwnerChecklist } from '../hooks';
import {
  CHECKLIST_LIMITS,
  SECTION_META,
  validateTaskDraft,
  type ChecklistOwner,
  type ChecklistTask,
  type TaskDraft,
} from '../model';
import { useTemplatesStore } from '../templatesStore';
import { PrioritySelector } from './Priority';

function ProvenanceNote({ task }: { task: ChecklistTask }) {
  useEnsureTemplatesLoaded();
  const template = useTemplatesStore((state) => state.templates.find((t) => t.id === task.sourceTemplateId));
  if (!task.sourceTemplateId) return null;
  return (
    <Notice
      tone="info"
      icon="content-copy"
      title={template ? `Copied from “${template.name}”` : 'Copied from a template'}
      message="This is the trip's own copy. Editing it here never changes the template, and editing the template never changes this task."
    />
  );
}

function TaskForm({ owner, task }: { owner: ChecklistOwner; task: ChecklistTask }) {
  const checklist = useOwnerChecklist(owner);
  const { updateTask, toggleTask, deleteTask } = useChecklistStore.getState();
  const [draft, setDraft] = useState<TaskDraft>({
    title: task.title,
    description: task.description,
    notes: task.notes,
    priority: task.priority,
  });
  const [sectionId, setSectionId] = useState(task.sectionId);
  const [isDone, setIsDone] = useState(task.isDone);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateTaskDraft(draft);
  const isTrip = owner.type === 'trip';
  const patch = (value: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...value }));

  // Group and Inventory source (trip checklists only). Moving to another section starts with no group.
  const [link, setLink] = useState<(TaskLink & { inventoryItemName: string | null }) | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const extras = useSectionExtras(isTrip ? sectionId : undefined);
  useEffect(() => {
    if (!isTrip) return;
    let live = true;
    void getRepositories()
      .then(({ sectionExtras }) => sectionExtras.taskLink(task.id))
      .then((l) => {
        if (!live) return;
        setLink(l);
        setGroupId(l?.groupId ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isTrip, task.id]);
  useEffect(() => {
    if (isTrip) void useSectionExtrasStore.getState().load(sectionId);
  }, [isTrip, sectionId]);
  const groupChoice = groupId && extras.groups.some((g) => g.id === groupId) ? groupId : null;

  // Inventory source and quantity (trip checklists; sections that hold items).
  useEnsureInventoryLoaded();
  const inventory = useInventoryStore((s) => s.items);
  const [itemId, setItemId] = useState<string | null | undefined>(undefined);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const chosenItem = itemId !== undefined ? itemId : (link?.inventoryItemId ?? null);
  const chosenQty = quantity ?? link?.quantity ?? 1;
  const targetSection = checklist.sections.find((s) => s.id === sectionId);
  const targetSettings = useSectionSettingsStore((s) => s.bySection[sectionId] ?? null);
  useEffect(() => {
    if (isTrip) void useSectionSettingsStore.getState().load([sectionId]);
  }, [isTrip, sectionId]);
  const canHoldItems = Boolean(isTrip && targetSection && holdsItems(targetSection, targetSettings));
  const itemName = (id: string | null) => (id ? (inventory.find((i) => i.id === id)?.name ?? link?.inventoryItemName ?? 'an item') : null);
  const itemMatches = itemQuery.trim()
    ? inventory.filter((i) => !i.archivedAt && i.name.toLowerCase().includes(itemQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  async function save() {
    setRevealed(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      if (isTrip && sectionId !== task.sectionId) {
        const clash = await (await getRepositories()).sectionExtras.linkConflict(task.id, sectionId);
        if (clash) throw new Error(`“${clash}” from your Inventory is already in that section.`);
      }
      await updateTask(owner, task.id, draft, { sectionId });
      if (isTrip && (sectionId !== task.sectionId || groupChoice !== (link?.groupId ?? null))) {
        await useSectionExtrasStore.getState().setTaskGroup(sectionId, task.id, groupChoice);
        if (sectionId !== task.sectionId) await useSectionExtrasStore.getState().load(task.sectionId);
      }
      if (isTrip && chosenItem !== (link?.inventoryItemId ?? null)) await useSectionExtrasStore.getState().setInventoryLink(sectionId, task.id, chosenItem);
      if (isTrip && chosenItem && chosenQty !== (link?.quantity ?? 1)) await useSectionExtrasStore.getState().setQuantity(sectionId, task.id, chosenQty);
      if (isTrip && isDone !== task.isDone) await toggleTask(owner, task.id);
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the task.'));
      setSaving(false);
    }
  }

  async function remove() {
    const confirmed = await confirmAction({
      title: 'Delete this task?',
      message: `“${task.title}” will be removed${isTrip ? ' from this trip' : ' from this template'}.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteTask(owner, task.id);
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not delete the task.'));
    }
  }

  return (
    <Screen
      testID="task-editor"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label="Save task"
            icon="content-save-outline"
            onPress={() => void save()}
            loading={saving}
            style={styles.primary}
            testID="task-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={isTrip ? 'Trip task' : 'Template task'} title="Edit task" />

      <TextField
        label="Title"
        value={draft.title}
        onChangeText={(title) => patch({ title })}
        error={revealed ? errors.title : undefined}
        maxLength={CHECKLIST_LIMITS.taskTitleMax}
        showCount
        testID="task-title-input"
      />
      <PrioritySelector value={draft.priority} onChange={(priority) => patch({ priority })} />
      <TextField
        label="Description"
        placeholder="What exactly needs doing?"
        value={draft.description}
        onChangeText={(description) => patch({ description })}
        error={revealed ? errors.description : undefined}
        maxLength={CHECKLIST_LIMITS.taskDescriptionMax}
        multiline
        testID="task-description-input"
      />
      <TextField
        label="Notes"
        placeholder="Sizes, booking numbers, where you left it…"
        value={draft.notes}
        onChangeText={(notes) => patch({ notes })}
        error={revealed ? errors.notes : undefined}
        maxLength={CHECKLIST_LIMITS.taskNotesMax}
        multiline
        testID="task-notes-input"
      />

      {checklist.sections.length > 1 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Section
          </AppText>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Section">
            {checklist.sections.filter((section) => section.id === task.sectionId || !isOldPackingSection(section)).map((section) => (
              <OptionTile
                key={section.id}
                layout="chip"
                label={section.title}
                icon={SECTION_META[section.kind].icon}
                selected={sectionId === section.id}
                onPress={() => {
                  if (section.id !== sectionId) setGroupId(null);
                  setSectionId(section.id);
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {isTrip && extras.groups.length > 0 ? (
        <View style={styles.group} testID="task-group-picker">
          <AppText variant="label" tone="textSecondary">
            Group
          </AppText>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Group">
            <OptionTile layout="chip" label="No group" icon="tray" selected={groupChoice === null} onPress={() => setGroupId(null)} testID="task-group-none" />
            {extras.groups.map((g) => (
              <OptionTile key={g.id} layout="chip" label={g.title} icon="folder-outline" selected={groupChoice === g.id} onPress={() => setGroupId(g.id)} testID={`task-group-${g.title}`} />
            ))}
          </View>
        </View>
      ) : null}

      {isTrip && chosenItem ? (
        <View style={styles.group}>
          <Notice
            tone="info"
            icon="archive-outline"
            title={`From your Inventory: ${itemName(chosenItem)} · ×${chosenQty}`}
            message="Linked to the original Inventory item. Editing, moving or deleting this task never changes or deletes it."
            testID="task-inventory-source"
          />
          <View style={styles.row}>
            <AppText variant="label" tone="textSecondary" style={styles.flex}>
              Quantity to take
            </AppText>
            <MiniStepper label="Quantity to take" value={chosenQty} min={1} max={99} onChange={setQuantity} testID="task-quantity" />
          </View>
          <Button label="Unlink from Inventory" icon="link-off" variant="ghost" size="sm" onPress={() => setItemId(null)} style={styles.left} testID="task-inventory-unlink" />
        </View>
      ) : canHoldItems ? (
        <View style={styles.group} testID="task-inventory-link">
          <AppText variant="label" tone="textSecondary">
            Inventory item (optional)
          </AppText>
          <SearchField value={itemQuery} onChangeText={setItemQuery} placeholder="Link to something you own" testID="task-inventory-search" />
          <View style={styles.chips}>
            {itemMatches.map((i) => (
              <OptionTile key={i.id} layout="chip" label={i.name} icon="archive-outline" selected={false} onPress={() => { setItemId(i.id); setItemQuery(''); }} testID={`task-inventory-option-${i.name}`} />
            ))}
          </View>
        </View>
      ) : null}

      {isTrip ? (
        <ToggleRow
          icon="check-circle-outline"
          label="Done"
          description="Completion belongs to this trip only."
          value={isDone}
          onChange={setIsDone}
          testID="task-done-toggle"
        />
      ) : null}

      <ProvenanceNote task={task} />
      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}

      <Button
        label="Delete task"
        icon="trash-can-outline"
        variant="danger"
        size="sm"
        onPress={() => void remove()}
        style={styles.delete}
        testID="task-delete"
      />
    </Screen>
  );
}

export function TaskEditorScreen({
  ownerType,
  ownerId,
  taskId,
}: {
  ownerType: ChecklistOwner['type'];
  ownerId: string | undefined;
  taskId: string | undefined;
}) {
  const owner = useOwner(ownerType, ownerId);
  const checklist = useOwnerChecklist(owner);
  const task = checklist.tasks.find((t) => t.id === taskId);

  // The form copies the task into local state on mount, so later store refreshes never reset typing.
  if (owner && task) return <TaskForm key={task.id} owner={owner} task={task} />;

  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Edit task" />
      {checklist.status === 'error' ? (
        <ErrorState message={checklist.error ?? 'Could not load this checklist.'} />
      ) : checklist.status === 'ready' && !task ? (
        <EmptyState icon="clipboard-remove-outline" title="Task not found" message="It may have been deleted." />
      ) : (
        <LoadingState label="Loading task…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  delete: {
    alignSelf: 'flex-start',
  },
  left: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
