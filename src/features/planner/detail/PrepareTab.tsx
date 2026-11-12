import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, IconButton, Notice, OptionTile, ProgressBar, TextField } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { COMPANION_LIMITS, SUGGESTED_TASKS, TASK_CATEGORIES, TASK_CATEGORY_META, taskProgress, type NodeTask, type TaskCategory } from '../companion';
import { useDetailAction, type DetailContext } from './shared';

function TaskRow({ task, ctx }: { task: NodeTask; ctx: DetailContext }) {
  const { act } = useDetailAction(ctx.tripId, ctx.node.id);
  return (
    <View style={styles.task}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.isDone }}
        accessibilityLabel={task.title}
        onPress={() => void act((c) => c.updateTask(task.id, { isDone: !task.isDone }))}
        style={({ pressed }) => [styles.check, pressed && styles.pressed]}
        testID={`detail-task-${task.title}`}
      >
        <Icon name={task.isDone ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={task.isDone ? colors.accent : colors.textMuted} />
        <AppText variant="body" tone={task.isDone ? 'textMuted' : 'textPrimary'} style={[styles.flex, task.isDone && styles.done]}>
          {task.title}
        </AppText>
      </Pressable>
      <IconButton icon="close" size="sm" variant="plain" tone="textMuted" accessibilityLabel={`Delete ${task.title}`} onPress={() => void act((c) => c.removeTask(task.id))} testID={`detail-task-delete-${task.title}`} />
    </View>
  );
}

export function PrepareTab({ ctx }: { ctx: DetailContext }) {
  const { act, busy, error } = useDetailAction(ctx.tripId, ctx.node.id);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('other');
  const tasks = ctx.details?.tasks ?? [];
  const progress = taskProgress(tasks);
  const existing = new Set(tasks.map((t) => t.title.toLocaleLowerCase()));
  const suggestions = SUGGESTED_TASKS.filter((s) => !existing.has(s.title.toLocaleLowerCase()));
  const groups = TASK_CATEGORIES.map((c) => ({ category: c, tasks: tasks.filter((t) => t.category === c) })).filter((g) => g.tasks.length > 0);

  return (
    <View style={styles.root} testID="detail-prepare">
      <Card>
        <View style={styles.group}>
          <View style={styles.inline}>
            <AppText variant="title" style={styles.flex}>
              Preparation
            </AppText>
            <AppText variant="captionStrong" tone="textSecondary" testID="detail-prepare-progress">
              {progress.total === 0 ? 'Nothing yet' : `${progress.done} of ${progress.total} done`}
            </AppText>
          </View>
          {progress.total > 0 ? <ProgressBar value={progress.done / progress.total} accessibilityLabel="Preparation progress" /> : null}
        </View>
      </Card>

      {groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <View style={styles.inline}>
            <Icon name={TASK_CATEGORY_META[group.category].icon} size={18} color={colors.textSecondary} />
            <AppText variant="label" tone="textSecondary">
              {TASK_CATEGORY_META[group.category].label}
            </AppText>
          </View>
          <Card padding="xs">
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} ctx={ctx} />
            ))}
          </Card>
        </View>
      ))}

      <View style={styles.group}>
        <TextField label="Add a task" placeholder="e.g. Book the jeep safari" value={title} onChangeText={setTitle} maxLength={COMPANION_LIMITS.titleMax} testID="detail-task-input" />
        <View style={styles.chips}>
          {TASK_CATEGORIES.map((c) => (
            <OptionTile key={c} layout="chip" label={TASK_CATEGORY_META[c].label} icon={TASK_CATEGORY_META[c].icon} selected={category === c} onPress={() => setCategory(c)} testID={`detail-task-cat-${c}`} />
          ))}
        </View>
        <Button
          label="Add task"
          icon="plus"
          size="sm"
          loading={busy}
          disabled={!title.trim()}
          onPress={() => void act((c) => c.addTask(ctx.node.id, { title, category })).then((ok) => ok && setTitle(''))}
          style={styles.left}
          testID="detail-task-add"
        />
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>

      {suggestions.length > 0 ? (
        <View style={styles.group} testID="detail-task-suggestions">
          <View style={styles.inline}>
            <AppText variant="label" tone="textSecondary" style={styles.flex}>
              Common things to check
            </AppText>
            <Button label="Add all" variant="ghost" size="sm" onPress={() => void act((c) => c.addTasks(ctx.node.id, suggestions))} testID="detail-task-add-all" />
          </View>
          <AppText variant="caption" tone="textMuted">
            General reminders, not facts about this place. Add the ones that apply.
          </AppText>
          {suggestions.map((s) => (
            <Pressable
              key={s.title}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s.title}`}
              onPress={() => void act((c) => c.addTask(ctx.node.id, s))}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              testID={`detail-suggest-${s.title}`}
            >
              <Icon name="plus-circle-outline" size={20} color={colors.accent} />
              <AppText variant="body" style={styles.flex}>
                {s.title}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  check: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  done: {
    textDecorationLine: 'line-through',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
