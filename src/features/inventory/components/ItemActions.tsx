import { router } from 'expo-router';
import { useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';

import { useInventoryStore } from '../inventoryStore';
import type { InventoryItemSummary } from '../model';

/**
 * Item management: edit, duplicate, availability, archive/restore and delete
 * (deleting asks first and explains that trip lists keep their own entries).
 */
export function useItemActions(item: InventoryItemSummary | undefined, options: { onDeleted?: () => void } = {}) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = useInventoryStore.getState;

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function remove(target: InventoryItemSummary) {
    const { inventory } = await getRepositories();
    const trips = await inventory.usage(target.id);
    const confirmed = await confirmAction({
      title: `Delete "${target.name}"?`,
      message:
        (trips.length > 0
          ? `It is on ${trips.length} trip packing ${trips.length === 1 ? 'list' : 'lists'}. Those lists keep their entry as a one-time item, and any reservation is released. `
          : '') + 'This removes the item from your inventory permanently. Archive it instead to keep its history.',
      confirmLabel: 'Delete item',
      destructive: true,
    });
    if (!confirmed) return;
    await store().deleteItem(target.id);
    options.onDeleted?.();
  }

  const actions: SheetAction[] = item
    ? [
        {
          key: 'edit',
          label: 'Edit item',
          icon: 'pencil-outline',
          onPress: () => router.push({ pathname: '/inventory/item/[itemId]/edit', params: { itemId: item.id } }),
        },
        {
          key: 'duplicate',
          label: 'Duplicate',
          icon: 'content-copy',
          description: 'A separate item with the same details',
          onPress: () =>
            run(async () => {
              const copy = await store().duplicateItem(item.id);
              router.push({ pathname: '/inventory/item/[itemId]', params: { itemId: copy.id } });
            }, 'Could not duplicate the item.'),
        },
        ...(item.availability !== 'available'
          ? [
              {
                key: 'available',
                label: 'Mark available',
                icon: 'check-circle-outline' as const,
                onPress: () => run(() => store().setAvailability(item.id, 'available'), 'Could not update the item.'),
              },
            ]
          : []),
        ...(item.availability !== 'damaged'
          ? [
              {
                key: 'damaged',
                label: 'Mark damaged',
                icon: 'wrench-outline' as const,
                description: 'Damaged items cannot be reserved for trips',
                onPress: () => run(() => store().setAvailability(item.id, 'damaged'), 'Could not update the item.'),
              },
            ]
          : []),
        ...(item.availability !== 'borrowed'
          ? [
              {
                key: 'borrowed',
                label: 'Mark borrowed (lent out)',
                icon: 'account-arrow-right-outline' as const,
                description: 'Someone else has it; it cannot be reserved',
                onPress: () => run(() => store().setAvailability(item.id, 'borrowed'), 'Could not update the item.'),
              },
            ]
          : []),
        item.archivedAt
          ? {
              key: 'restore',
              label: 'Restore from archive',
              icon: 'archive-arrow-up-outline',
              onPress: () => run(() => store().setArchived(item.id, false), 'Could not restore the item.'),
            }
          : {
              key: 'archive',
              label: 'Archive',
              icon: 'archive-arrow-down-outline',
              description: 'Hide it from your active inventory; restore any time',
              onPress: () => run(() => store().setArchived(item.id, true), 'Could not archive the item.'),
            },
        {
          key: 'delete',
          label: 'Delete item…',
          icon: 'trash-can-outline',
          description: 'Asks for confirmation first',
          destructive: true,
          onPress: () => run(() => remove(item), 'Could not delete the item.'),
        },
      ]
    : [];

  const sheet = item ? (
    <ActionSheet
      visible={visible}
      title={item.name}
      subtitle={`Quantity ${item.quantity}`}
      actions={actions}
      onClose={() => setVisible(false)}
      testID="item-actions-sheet"
    />
  ) : null;

  return {
    open: () => {
      setError(null);
      setVisible(true);
    },
    sheet,
    error,
    clearError: () => setError(null),
  };
}
