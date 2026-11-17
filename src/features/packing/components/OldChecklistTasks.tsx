import { StyleSheet, View } from 'react-native';
import { useState } from 'react';

import { AppText, Button, Card, Notice } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';

import { PRIORITY_META } from '../../preparation/model';
import type { OldChecklistTask } from '../unifiedPackingRepository';
import { useTripPackingExtras, useUnifiedPackingStore } from '../unifiedPackingStore';

/**
 * Tasks still in the trip's old Packing (or Clothing) checklist section. Packing now lives in
 * this list, so each task can be moved here, kept in the checklist, or removed — always after
 * confirmation, one at a time. Nothing happens automatically.
 */
export function OldChecklistTasks({ tripId }: { tripId: string }) {
  const { oldTasks } = useTripPackingExtras(tripId);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  if (oldTasks.length === 0 && !message) return null;

  const act = async (task: OldChecklistTask, action: 'convert' | 'keep' | 'remove') => {
    const confirm =
      action === 'convert'
        ? {
            title: `Move “${task.title}” to the packing list?`,
            message: `It becomes a packing item${task.quantity > 1 ? ` (×${task.quantity})` : ''} with its priority, notes${task.inventoryItemId ? ' and Inventory link' : ''}${task.isDone ? ', marked packed' : ''}. The checklist task is removed only after the item is saved.`,
            confirmLabel: 'Move to packing list',
          }
        : action === 'keep'
          ? { title: `Keep “${task.title}” in the checklist?`, message: 'It stays a checklist task in its section and is not offered here again.', confirmLabel: 'Keep in checklist' }
          : {
              title: `Remove “${task.title}” from this trip?`,
              message: `The checklist task is deleted.${task.inventoryItemId ? ' Your Inventory item is not touched.' : ''}`,
              confirmLabel: 'Remove from trip',
              destructive: true,
            };
    if (!(await confirmAction(confirm))) return;
    setBusy(task.taskId);
    setMessage(null);
    try {
      const store = useUnifiedPackingStore.getState();
      if (action === 'convert') await store.convertTask(tripId, task.taskId);
      else if (action === 'keep') await store.keepTask(tripId, task.taskId);
      else await store.removeTask(tripId, task.taskId);
      setMessage({ tone: 'success', text: action === 'convert' ? `“${task.title}” is now on the packing list.` : action === 'keep' ? `“${task.title}” stays in the checklist.` : `“${task.title}” was removed.` });
    } catch (e) {
      setMessage({ tone: 'danger', text: toErrorMessage(e, 'That did not work; nothing was changed.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card testID="old-checklist">
      <View style={styles.group}>
        <AppText variant="title">From your old checklist</AppText>
        <AppText variant="caption" tone="textSecondary">
          Packing now lives here. These tasks are still in the checklist’s {oldTasks[0]?.sectionTitle ?? 'Packing'} section — decide for each one.
        </AppText>
        {message ? <Notice tone={message.tone} title={message.text} testID="old-checklist-message" /> : null}
        {oldTasks.map((task) => (
          <View key={task.taskId} style={styles.task} testID={`old-task-${task.title}`}>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {task.title}
              {task.quantity > 1 ? ` ×${task.quantity}` : ''}
            </AppText>
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {[PRIORITY_META[task.priority].label, task.sectionTitle, task.isDone ? 'Done' : null, task.inventoryItemName ? `Inventory: ${task.inventoryItemName}` : null].filter(Boolean).join(' · ')}
            </AppText>
            <View style={styles.actions}>
              <Button label="Move to packing list" icon="bag-checked" size="sm" loading={busy === task.taskId} disabled={busy !== null} onPress={() => void act(task, 'convert')} testID={`old-task-move-${task.title}`} />
              <Button label="Keep in checklist" size="sm" variant="secondary" disabled={busy !== null} onPress={() => void act(task, 'keep')} testID={`old-task-keep-${task.title}`} />
              <Button label="Remove" icon="delete-outline" size="sm" variant="ghost" disabled={busy !== null} onPress={() => void act(task, 'remove')} testID={`old-task-remove-${task.title}`} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  task: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
