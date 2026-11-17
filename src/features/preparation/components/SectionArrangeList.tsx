import { useCallback, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { DraggableList, type DraggableItem, type MoveAction, type RenderContext } from '../../planner/components/DraggableList';
import type { ChecklistGroup } from '../sectionExtrasRepository';
import type { ChecklistTask } from '../model';
import { placeGroup, placeTask, type SectionLayout } from '../sectionLayout';

export type { SectionLayout };

export interface TaskReorder {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
}

type Row = (DraggableItem & { kind: 'group'; group: ChecklistGroup }) | (DraggableItem & { kind: 'task'; task: ChecklistTask; groupId: string | null });

const G = (id: string) => `g:${id}`;
const T = (id: string) => `t:${id}`;
const raw = (id: string) => id.slice(2);

/**
 * The section's groups and tasks in one list for arranging: drag a group to reorder groups,
 * drag a task within its group, into another group, or out of any group. Every row also has
 * Move up / Move down buttons, and screen readers get the same moves on the drag handle.
 */
export function SectionArrangeList({
  groups,
  tasks,
  groupOf,
  onArrange,
  renderTask,
}: {
  groups: readonly ChecklistGroup[];
  /** The section's tasks in position order. */
  tasks: readonly ChecklistTask[];
  groupOf: (task: ChecklistTask) => string | null;
  onArrange: (layout: SectionLayout) => void;
  /** Renders a task row; `reorder` drives its Move up / Move down arrows. */
  renderTask: (task: ChecklistTask, reorder: TaskReorder) => ReactNode;
}) {
  const layout: SectionLayout = useMemo(
    () => ({ groupIds: groups.map((g) => g.id), tasks: tasks.map((t) => ({ id: t.id, groupId: groupOf(t) })) }),
    [groups, tasks, groupOf],
  );
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const group of groups) {
      const own = tasks.filter((t) => groupOf(t) === group.id);
      out.push({ id: G(group.id), parentId: null, depth: 0, expanded: true, hasChildren: own.length > 0, draggable: true, kind: 'group', group });
      for (const task of own) out.push({ id: T(task.id), parentId: G(group.id), depth: 1, expanded: false, hasChildren: false, draggable: true, kind: 'task', task, groupId: group.id });
    }
    for (const task of tasks.filter((t) => groupOf(t) === null)) out.push({ id: T(task.id), parentId: null, depth: 0, expanded: false, hasChildren: false, draggable: true, kind: 'task', task, groupId: null });
    return out;
  }, [groups, tasks, groupOf]);
  const siblings = useMemo(() => {
    const map = new Map<string | null, string[]>();
    for (const row of rows) map.set(row.parentId, [...(map.get(row.parentId) ?? []), row.id]);
    for (const g of groups) if (!map.has(G(g.id))) map.set(G(g.id), []);
    return map;
  }, [rows, groups]);
  const subtreeOf = useCallback((id: string) => [id, ...rows.filter((r) => r.parentId === id).map((r) => r.id)], [rows]);
  // Groups stay at the top level; tasks go into any group or out of all groups.
  const canPlaceIn = useCallback((dragged: string, parentId: string | null) => (dragged.startsWith('g:') ? parentId === null : parentId === null || parentId.startsWith('g:')), []);
  const groupCount = groups.length;

  const drop = (id: string, target: { parentId: string | null; index: number }) => {
    if (id.startsWith('g:')) {
      onArrange(placeGroup(layout, raw(id), Math.min(target.index, groupCount - 1)));
      return;
    }
    if (target.parentId === null) {
      // Top level: groups first, then the tasks that are not in a group.
      onArrange(placeTask(layout, raw(id), null, Math.max(0, target.index - groupCount)));
      return;
    }
    onArrange(placeTask(layout, raw(id), raw(target.parentId), target.index));
  };

  const move = (id: string, action: MoveAction) => {
    if (id.startsWith('g:')) {
      const i = layout.groupIds.indexOf(raw(id));
      if (action === 'up' && i > 0) onArrange(placeGroup(layout, raw(id), i - 1));
      if (action === 'down' && i < groupCount - 1) onArrange(placeGroup(layout, raw(id), i + 1));
      return;
    }
    const entry = layout.tasks.find((t) => t.id === raw(id));
    if (!entry) return;
    if (action === 'out') {
      if (entry.groupId !== null) onArrange(placeTask(layout, entry.id, null, 0));
      return;
    }
    const same = layout.tasks.filter((t) => t.groupId === entry.groupId);
    const i = same.findIndex((t) => t.id === entry.id);
    if (action === 'up' && i > 0) onArrange(placeTask(layout, entry.id, entry.groupId, i - 1));
    if (action === 'down' && i < same.length - 1) onArrange(placeTask(layout, entry.id, entry.groupId, i + 1));
  };

  const arrows = (row: Row, title: string, canUp: boolean, canDown: boolean) => (
    <View style={styles.arrows}>
      <IconButton icon="arrow-up" size="sm" variant="plain" accessibilityLabel={`Move ${title} up`} disabled={!canUp} onPress={() => move(row.id, 'up')} testID={`arrange-up-${title}`} />
      <IconButton icon="arrow-down" size="sm" variant="plain" accessibilityLabel={`Move ${title} down`} disabled={!canDown} onPress={() => move(row.id, 'down')} testID={`arrange-down-${title}`} />
    </View>
  );

  const firstLoose = rows.find((r) => r.kind === 'task' && r.groupId === null)?.id;
  const render = (row: Row, context: RenderContext) => {
    if (row.kind === 'group') {
      const i = layout.groupIds.indexOf(row.group.id);
      return (
        <View style={[styles.groupRow, context.isDropInside && styles.dropInside, context.isDragging && styles.dragging]} testID={`arrange-group-${row.group.title}`}>
          {context.handle}
          <AppText variant="title" numberOfLines={1} style={styles.flex}>
            {row.group.title}
          </AppText>
          {arrows(row, row.group.title, i > 0, i < groupCount - 1)}
        </View>
      );
    }
    const same = layout.tasks.filter((t) => t.groupId === row.groupId);
    const i = same.findIndex((t) => t.id === row.task.id);
    return (
      <View style={[styles.taskWrap, context.isDragging && styles.dragging]} testID={`arrange-task-${row.task.title}`}>
        {row.id === firstLoose && groupCount > 0 ? (
          <AppText variant="label" tone="textMuted" style={styles.loose}>
            Not in a group
          </AppText>
        ) : null}
        <View style={styles.taskRow}>
          {context.handle}
          <View style={styles.flex}>{renderTask(row.task, { canMoveUp: i > 0, canMoveDown: i < same.length - 1, onMove: (d) => move(row.id, d < 0 ? 'up' : 'down') })}</View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <AppText variant="label" tone="textMuted">
        Drag the handles, or use the arrows. Drop a task on a group to move it there.
      </AppText>
      <DraggableList
        items={rows}
        allowNest
        siblings={siblings}
        subtreeOf={subtreeOf}
        canPlaceIn={canPlaceIn}
        onDrop={drop}
        onAccessibleMove={move}
        renderItem={render}
        indent={spacing.lg}
        testID="section-arrange"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  flex: { flex: 1 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md },
  dropInside: { backgroundColor: colors.accentSoft },
  dragging: { opacity: 0.6 },
  taskWrap: { gap: spacing.xs },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  arrows: { flexDirection: 'row' },
  loose: { marginTop: spacing.sm },
});
