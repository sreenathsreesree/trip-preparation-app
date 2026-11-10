import { useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';

import { PURCHASE_STATUS_META, type PurchaseItem, type PurchaseStatus } from '../model';
import { usePackingStore } from '../packingStore';

/**
 * Status changes and follow-ups for a shopping-list entry. A purchase never
 * packs itself: adding it to a trip creates an unpacked entry.
 */
export function usePurchaseActions() {
  const [target, setTarget] = useState<PurchaseItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const store = usePackingStore.getState;

  const run = (fn: () => Promise<unknown>, fallback: string, done?: string) => {
    setError(null);
    setNotice(null);
    fn()
      .then(() => done && setNotice(done))
      .catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  const status = (purchase: PurchaseItem, next: PurchaseStatus): SheetAction => ({
    key: `status-${next}`,
    label: next === 'needed' ? 'Still need to buy it' : PURCHASE_STATUS_META[next].label,
    icon: PURCHASE_STATUS_META[next].icon,
    description:
      next === 'owned'
        ? 'You found one at home — nothing to buy'
        : next === 'borrowed'
          ? 'Someone is lending you one'
          : next === 'skipped'
            ? 'Not needed after all (kept in history)'
            : undefined,
    onPress: () => run(() => store().setPurchaseStatus(purchase.tripId, purchase.id, next), 'Could not update the item.'),
  });

  let actions: SheetAction[] = [];
  if (target) {
    const p = target;
    const statuses: PurchaseStatus[] =
      p.status === 'needed' ? ['purchased', 'owned', 'borrowed', 'skipped'] : ['needed'];
    actions = statuses.map((next) => status(p, next));
    if ((p.status === 'purchased' || p.status === 'owned') && !p.inventoryItemId) {
      actions.push({
        key: 'inventory',
        label: 'Add to my inventory',
        icon: 'archive-plus-outline',
        description: 'Keep it for future trips',
        onPress: () =>
          run(() => store().purchaseToInventory(p.tripId, p.id), 'Could not add it to your inventory.', `${p.name} added to your inventory.`),
      });
    }
    if (p.tripId && !p.packingEntryId && p.status !== 'needed' && p.status !== 'skipped') {
      const tripId = p.tripId;
      actions.push({
        key: 'trip',
        label: `Add to ${p.tripName} packing list`,
        icon: 'bag-personal-plus-outline',
        description: p.inventoryItemId ? 'Linked to your inventory item, not yet packed' : 'As a one-time item, not yet packed',
        onPress: () =>
          run(() => store().purchaseToTrip(tripId, p.id), 'Could not add it to the packing list.', `${p.name} added to the packing list.`),
      });
    }
    actions.push({
      key: 'remove',
      label: 'Remove from shopping list',
      icon: 'trash-can-outline',
      destructive: true,
      onPress: () =>
        run(async () => {
          const ok = await confirmAction({
            title: `Remove "${p.name}"?`,
            message: 'It disappears from the shopping list and its history. Items already added to your inventory or a packing list stay there.',
            confirmLabel: 'Remove',
            destructive: true,
          });
          if (ok) await store().removePurchase(p.tripId, p.id);
        }, 'Could not remove the item.'),
    });
  }

  return {
    open: (purchase: PurchaseItem) => {
      setError(null);
      setNotice(null);
      setTarget(purchase);
    },
    error,
    notice,
    clearNotice: () => setNotice(null),
    sheet: (
      <ActionSheet
        visible={target !== null}
        title={target?.name ?? ''}
        subtitle={target ? `${PURCHASE_STATUS_META[target.status].label} · ×${target.quantity}` : undefined}
        actions={actions}
        onClose={() => setTarget(null)}
        testID="purchase-actions"
      />
    ),
  };
}
