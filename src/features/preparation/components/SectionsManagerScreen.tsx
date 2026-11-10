import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  ReorderControls,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { colors, fontFamilies, radii, sizes, spacing } from '@/theme';

import { useChecklistStore } from '../checklistStore';
import { useOwner, useOwnerChecklist } from '../hooks';
import { CHECKLIST_LIMITS, normalizeTitle, SECTION_META, type ChecklistOwner, type ChecklistSection } from '../model';
import { AddItemBar } from './AddItemBar';

function SectionRow({
  section,
  taskCount,
  index,
  total,
  onRename,
  onMove,
  onDelete,
}: {
  section: ChecklistSection;
  taskCount: number;
  index: number;
  total: number;
  onRename: (title: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(section.title);
  const meta = SECTION_META[section.kind];
  const commit = () => {
    const clean = normalizeTitle(title);
    if (clean.length === 0) setTitle(section.title);
    else if (clean !== section.title) onRename(clean);
  };

  return (
    <View style={styles.row} testID={`section-row-${index}`}>
      <Icon name={meta.icon} color={meta.tint} />
      <View style={styles.rowText}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          maxLength={CHECKLIST_LIMITS.sectionTitleMax}
          accessibilityLabel={`Section name, ${section.title}`}
          selectionColor={colors.accent}
          style={styles.input}
          testID={`section-name-${index}`}
        />
        <AppText variant="caption" tone="textMuted">
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </AppText>
      </View>
      <ReorderControls
        label={section.title}
        canMoveUp={index > 0}
        canMoveDown={index < total - 1}
        onMove={onMove}
        testID={`section-move-${index}`}
      />
      <IconButton
        icon="trash-can-outline"
        tone="danger"
        variant="plain"
        size="sm"
        accessibilityLabel={`Delete section ${section.title}`}
        onPress={onDelete}
        testID={`section-delete-${index}`}
      />
    </View>
  );
}

export function SectionsManagerScreen({
  ownerType,
  ownerId,
  ownerName,
}: {
  ownerType: ChecklistOwner['type'];
  ownerId: string | undefined;
  ownerName?: string;
}) {
  const owner = useOwner(ownerType, ownerId);
  const checklist = useOwnerChecklist(owner);
  const { load, addSection, renameSection, moveSection, deleteSection } = useChecklistStore.getState();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function confirmDelete(section: ChecklistSection, taskCount: number) {
    if (!owner) return;
    const confirmed =
      taskCount === 0 ||
      (await confirmAction({
        title: `Delete “${section.title}”?`,
        message: `This section and its ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} will be removed${
          owner.type === 'trip' ? ' from this trip' : ' from this template'
        }.`,
        confirmLabel: 'Delete section',
        destructive: true,
      }));
    if (confirmed) run(() => deleteSection(owner, section.id), 'Could not delete the section.');
  }

  return (
    <Screen testID="sections-manager" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={ownerName}
        title="Manage sections"
        subtitle="Rename, reorder, add or remove the sections of this checklist."
      />
      {error ? <Notice tone="danger" title="Something went wrong" message={error} /> : null}

      {!owner || checklist.status === 'error' ? (
        <ErrorState
          message={checklist.error ?? 'Could not load this checklist.'}
          onRetry={owner ? () => void load(owner) : undefined}
        />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading sections…" />
      ) : (
        <>
          {checklist.sections.length === 0 ? (
            <EmptyState icon="format-list-group" title="No sections yet" message="Add your first section below." />
          ) : (
            <View style={styles.list}>
              {checklist.sections.map((section, index) => {
                const taskCount = checklist.tasks.filter((t) => t.sectionId === section.id).length;
                return (
                  <SectionRow
                    key={`${section.id}-${section.title}`}
                    section={section}
                    taskCount={taskCount}
                    index={index}
                    total={checklist.sections.length}
                    onRename={(title) => run(() => renameSection(owner, section.id, title), 'Could not rename.')}
                    onMove={(direction) =>
                      run(() => moveSection(owner, section.id, direction), 'Could not move the section.')
                    }
                    onDelete={() => void confirmDelete(section, taskCount)}
                  />
                );
              })}
            </View>
          )}
          <AddItemBar
            placeholder="New section name, e.g. Camera gear"
            maxLength={CHECKLIST_LIMITS.sectionTitleMax}
            onAdd={(title) => addSection(owner, title)}
            testID="add-section"
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    minHeight: sizes.buttonHeightSmall,
    color: colors.textPrimary,
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 15,
    paddingVertical: 0,
  },
});
