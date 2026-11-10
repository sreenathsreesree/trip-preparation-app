import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  ActionSheet,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useChecklistStore } from '../checklistStore';
import { useEnsureTemplatesLoaded, useOwner, useOwnerChecklist } from '../hooks';
import { emptyTaskDraft, groupTasksBySection, SECTION_META, type ChecklistTask } from '../model';
import type { TemplateSummary } from '../templateRepository';
import { useTemplatesStore } from '../templatesStore';
import { AddItemBar } from './AddItemBar';
import { TaskRow } from './TaskRow';

function TemplateBody({ template }: { template: TemplateSummary }) {
  const owner = useOwner('template', template.id);
  const checklist = useOwnerChecklist(owner);
  const { load, addSection, addTask, deleteTask, moveTask, forget } = useChecklistStore.getState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!owner) return null;
  const grouped = groupTasksBySection(checklist.tasks);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  const openTask = (task: ChecklistTask) =>
    router.push({
      pathname: '/templates/[templateId]/tasks/[taskId]',
      params: { templateId: template.id, taskId: task.id },
    });

  async function removeTemplate() {
    const confirmed = await confirmAction({
      title: `Delete “${template.name}”?`,
      message:
        'The template and its tasks will be deleted. Trips that already used it keep their own copies of its tasks.',
      confirmLabel: 'Delete template',
      destructive: true,
    });
    if (!confirmed || !owner) return;
    await useTemplatesStore.getState().remove(template.id);
    forget(owner);
    router.back();
  }

  return (
    <Screen testID="template-editor" bottomInset onRefresh={() => void load(owner)}>
      <ScreenHeader
        showBack
        eyebrow="Checklist template"
        title={template.name}
        subtitle={template.description || undefined}
        trailing={
          <IconButton
            icon="dots-horizontal"
            accessibilityLabel="Template actions"
            onPress={() => setMenuOpen(true)}
            testID="template-actions"
          />
        }
      />

      <View style={styles.meta}>
        <AppText variant="caption" tone="textMuted">
          {template.taskCount} {template.taskCount === 1 ? 'task' : 'tasks'} · {template.sectionCount}{' '}
          {template.sectionCount === 1 ? 'section' : 'sections'} · Edited{' '}
          {formatDate(template.updatedAt.slice(0, 10), { withYear: true })}
        </AppText>
        {checklist.tasks.length > 1 ? (
          <Button
            label={reordering ? 'Done' : 'Reorder'}
            icon={reordering ? 'check' : 'swap-vertical'}
            variant={reordering ? 'primary' : 'secondary'}
            size="sm"
            onPress={() => setReordering((value) => !value)}
            testID="template-toggle-reorder"
          />
        ) : null}
      </View>

      <Notice
        tone="info"
        icon="shield-check-outline"
        title="Editing a template never changes existing trips"
        message="Trips get their own copy when you add a template. To pull new tasks into a trip later, use “Add from template” on the trip — only missing tasks are added."
      />
      {error ? <Notice tone="danger" title="Something went wrong" message={error} /> : null}

      {checklist.status === 'error' ? (
        <ErrorState message={checklist.error ?? 'Could not load this template.'} onRetry={() => void load(owner)} />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading template…" />
      ) : checklist.sections.length === 0 ? (
        <View style={styles.block}>
          <EmptyState
            icon="format-list-group"
            title="Start with a section"
            message="Sections group tasks, e.g. Packing, Documents or Camera gear."
          />
          <AddItemBar
            placeholder="First section name"
            onAdd={(title) => addSection(owner, title)}
            testID="add-section"
          />
        </View>
      ) : (
        <View style={styles.sections}>
          {checklist.sections.map((section) => {
            const tasks = grouped.get(section.id) ?? [];
            const meta = SECTION_META[section.kind];
            return (
              <View key={section.id} style={styles.block} testID={`template-section-${section.title}`}>
                <View style={styles.sectionHeader}>
                  <Icon name={meta.icon} color={meta.tint} />
                  <AppText variant="h3" style={styles.flex} numberOfLines={1}>
                    {section.title}
                  </AppText>
                  <AppText variant="caption" tone="textMuted">
                    {tasks.length}
                  </AppText>
                </View>
                {tasks.map((task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    tint={meta.tint}
                    onOpen={openTask}
                    onDelete={(t) => run(() => deleteTask(owner, t.id), 'Could not delete the task.')}
                    reorder={
                      reordering
                        ? {
                            canMoveUp: index > 0,
                            canMoveDown: index < tasks.length - 1,
                            onMove: (direction) =>
                              run(() => moveTask(owner, task.id, direction), 'Could not move the task.'),
                          }
                        : undefined
                    }
                  />
                ))}
                {reordering ? null : (
                  <AddItemBar
                    placeholder={`Add a task to ${section.title}`}
                    withPriority
                    onAdd={(title, priority) => addTask(owner, section.id, { ...emptyTaskDraft(priority), title })}
                    testID={`add-task-${section.title}`}
                  />
                )}
              </View>
            );
          })}
          <Button
            label="Manage sections"
            icon="tune-variant"
            variant="secondary"
            size="sm"
            onPress={() =>
              router.push({ pathname: '/templates/[templateId]/sections', params: { templateId: template.id } })
            }
            style={styles.manage}
            testID="template-manage-sections"
          />
        </View>
      )}

      <ActionSheet
        visible={menuOpen}
        title={template.name}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            key: 'edit',
            label: 'Edit name and description',
            icon: 'pencil-outline',
            onPress: () =>
              router.push({ pathname: '/templates/[templateId]/edit', params: { templateId: template.id } }),
          },
          {
            key: 'sections',
            label: 'Manage sections',
            icon: 'tune-variant',
            onPress: () =>
              router.push({ pathname: '/templates/[templateId]/sections', params: { templateId: template.id } }),
          },
          {
            key: 'duplicate',
            label: 'Duplicate template',
            icon: 'content-copy',
            description: 'An independent copy you can change freely',
            onPress: () =>
              run(async () => {
                const copy = await useTemplatesStore.getState().duplicate(template.id);
                router.push({ pathname: '/templates/[templateId]', params: { templateId: copy.id } });
              }, 'Could not duplicate the template.'),
          },
          {
            key: 'delete',
            label: 'Delete template…',
            icon: 'trash-can-outline',
            description: 'Trips that used it are not affected',
            destructive: true,
            onPress: () => run(removeTemplate, 'Could not delete the template.'),
          },
        ]}
      />
    </Screen>
  );
}

export function TemplateEditorScreen({ templateId }: { templateId: string | undefined }) {
  useEnsureTemplatesLoaded();
  const status = useTemplatesStore((state) => state.status);
  const error = useTemplatesStore((state) => state.error);
  const load = useTemplatesStore((state) => state.load);
  const template = useTemplatesStore((state) => state.templates.find((t) => t.id === templateId));

  if (template) return <TemplateBody template={template} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Template" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load templates.'} onRetry={() => void load()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="file-question-outline"
          title="Template not found"
          message="It may have been deleted."
          action={{ label: 'All templates', onPress: () => router.replace('/checklists') }}
        />
      ) : (
        <LoadingState label="Loading template…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  sections: {
    gap: spacing.xxl,
  },
  block: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  flex: {
    flex: 1,
  },
  manage: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
  },
});
