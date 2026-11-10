import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { AppText, Icon, IconButton, ReorderControls } from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import type { ChecklistTask } from '../model';
import { PriorityBadge } from './Priority';

export interface TaskRowProps {
  task: ChecklistTask;
  tint: string;
  /** Trip rows have a checkbox; template rows do not (templates have no completion). */
  onToggle?: (task: ChecklistTask) => void;
  onOpen: (task: ChecklistTask) => void;
  onDelete: (task: ChecklistTask) => void;
  /** When set, the row shows reorder controls instead of the chevron. */
  reorder?: { canMoveUp: boolean; canMoveDown: boolean; onMove: (direction: -1 | 1) => void };
  /** Optional context line, e.g. the section a task belongs to. */
  context?: string;
  /** Hide the priority badge (e.g. in a list that only contains essentials). */
  hidePriority?: boolean;
}

/** Checklist row: tick the box, tap the text to edit, swipe left to delete. */
export function TaskRow({
  task,
  tint,
  onToggle,
  onOpen,
  onDelete,
  reorder,
  context,
  hidePriority = false,
}: TaskRowProps) {
  const swipeable = useRef<SwipeableMethods>(null);
  const done = Boolean(onToggle) && task.isDone;
  const essentialOpen = task.priority === 'essential' && !task.isDone && Boolean(onToggle);
  const meta = [context, task.description].filter(Boolean).join(' · ');

  return (
    // No exit animation: rows move between groups (to do / done / reorder) and a
    // fading copy would overlap the re-rendered list.
    <Animated.View entering={FadeIn.duration(180)} layout={LinearTransition}>
      <ReanimatedSwipeable
        ref={swipeable}
        friction={2}
        rightThreshold={40}
        overshootRight={false}
        enabled={!reorder}
        renderRightActions={() => (
          <View style={styles.deleteAction}>
            <IconButton
              icon="trash-can-outline"
              tone="danger"
              variant="plain"
              accessibilityLabel={`Delete ${task.title}`}
              onPress={() => {
                swipeable.current?.close();
                onDelete(task);
              }}
            />
          </View>
        )}
      >
        <View style={[styles.row, essentialOpen && styles.essentialRow]}>
          {onToggle ? (
            <Pressable
              testID={`task-check-${task.id}`}
              accessibilityRole="checkbox"
              accessibilityLabel={task.title}
              accessibilityState={{ checked: task.isDone }}
              hitSlop={6}
              onPress={() => {
                selectionFeedback();
                onToggle(task);
              }}
              style={styles.checkArea}
            >
              <View
                style={[
                  styles.checkbox,
                  { borderColor: task.isDone ? tint : essentialOpen ? colors.danger : colors.borderStrong },
                  task.isDone && { backgroundColor: tint },
                ]}
              >
                {task.isDone ? <Icon name="check-bold" size={14} tone="textOnAccent" /> : null}
              </View>
            </Pressable>
          ) : (
            <View style={styles.bulletArea}>
              <View style={[styles.bullet, { backgroundColor: tint }]} />
            </View>
          )}

          <Pressable
            testID={`task-open-${task.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${task.title}. Edit task`}
            accessibilityActions={[{ name: 'delete', label: 'Delete task' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'delete') onDelete(task);
            }}
            disabled={Boolean(reorder)}
            onPress={() => onOpen(task)}
            style={({ pressed }) => [styles.body, pressed && styles.pressed]}
          >
            <View style={styles.text}>
              <AppText
                variant="body"
                tone={done ? 'textMuted' : 'textPrimary'}
                style={done ? styles.doneText : undefined}
              >
                {task.title}
              </AppText>
              {meta || task.notes ? (
                <View style={styles.metaRow}>
                  {task.notes ? <Icon name="note-text-outline" size={14} tone="textMuted" /> : null}
                  {meta ? (
                    <AppText variant="caption" tone="textMuted" numberOfLines={1} style={styles.flex}>
                      {meta}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </View>
            {hidePriority ? null : <PriorityBadge priority={task.priority} />}
            {reorder ? null : <Icon name="chevron-right" size={18} tone="textMuted" />}
          </Pressable>

          {reorder ? (
            <ReorderControls
              label={task.title}
              canMoveUp={reorder.canMoveUp}
              canMoveDown={reorder.canMoveDown}
              onMove={reorder.onMove}
              testID={`task-move-${task.id}`}
            />
          ) : null}
        </View>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: spacing.xs,
  },
  essentialRow: {
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  checkArea: {
    width: 48,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletArea: {
    width: 32,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingRight: spacing.sm,
    minHeight: 52,
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  doneText: {
    textDecorationLine: 'line-through',
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    marginLeft: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
});
