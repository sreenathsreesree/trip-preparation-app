import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { Screen } from '@/components/layout/Screen';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  OptionTile,
  TextField,
  ToggleRow,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useChecklistStore } from '../checklistStore';
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

  async function save() {
    setRevealed(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      await updateTask(owner, task.id, draft, { sectionId });
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
            {checklist.sections.map((section) => (
              <OptionTile
                key={section.id}
                layout="chip"
                label={section.title}
                icon={SECTION_META[section.kind].icon}
                selected={sectionId === section.id}
                onPress={() => setSectionId(section.id)}
              />
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
});
