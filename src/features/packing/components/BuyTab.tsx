import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, MiniStepper, Notice, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { PACKING_LIMITS, PURCHASE_STATUSES, PURCHASE_STATUS_META, type PurchaseItem } from '../model';
import { usePackingStore } from '../packingStore';
import { PurchaseRow } from './PackingParts';
import { usePurchaseActions } from './PurchaseActions';

export function PurchaseGroups({
  purchases,
  showTrip,
  onOpen,
}: {
  purchases: readonly PurchaseItem[];
  showTrip?: boolean;
  onOpen: (purchase: PurchaseItem) => void;
}) {
  return (
    <>
      {PURCHASE_STATUSES.map((status) => {
        const rows = purchases.filter((p) => p.status === status);
        if (rows.length === 0) return null;
        return (
          <View key={status} style={styles.group}>
            <AppText variant="label" tone="textMuted">
              {PURCHASE_STATUS_META[status].label} ({rows.length})
            </AppText>
            {rows.map((purchase) => (
              <PurchaseRow key={purchase.id} purchase={purchase} showTrip={showTrip} onOpen={onOpen} />
            ))}
          </View>
        );
      })}
    </>
  );
}

export function BuyTab({ tripId, purchases }: { tripId: string; purchases: readonly PurchaseItem[] }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
  const actions = usePurchaseActions();

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMessage(null);
    try {
      const { duplicate } = await usePackingStore.getState().addPurchase(tripId, trimmed, quantity, null);
      if (duplicate) setMessage({ tone: 'info', text: `"${trimmed}" is already on this shopping list.` });
      setName('');
      setQuantity(1);
    } catch (err) {
      setMessage({ tone: 'danger', text: toErrorMessage(err, 'Could not add it.') });
    }
  }

  return (
    <View style={styles.container} testID="buy-tab">
      <View style={styles.addRow}>
        <View style={styles.flex}>
          <TextField
            label="Need to buy"
            placeholder="e.g. Travel adapter"
            value={name}
            onChangeText={setName}
            maxLength={PACKING_LIMITS.nameMax}
            returnKeyType="done"
            onSubmitEditing={() => void add()}
            testID="purchase-name-input"
          />
        </View>
        <MiniStepper value={quantity} min={1} max={PACKING_LIMITS.quantityMax} label="Quantity to buy" onChange={setQuantity} />
      </View>
      <Button label="Add to shopping list" icon="cart-plus" variant="secondary" onPress={() => void add()} disabled={!name.trim()} testID="purchase-add" />
      {message ? <Notice tone={message.tone} title={message.text} /> : null}
      {actions.error ? <Notice tone="danger" title="Not updated" message={actions.error} /> : null}
      {actions.notice ? <Notice tone="success" title={actions.notice} /> : null}

      {purchases.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Nothing to buy"
          message="Add things you still need, or send a suggestion here with Buy. Bought items are never packed automatically."
        />
      ) : (
        <PurchaseGroups purchases={purchases} onOpen={actions.open} />
      )}

      <Button
        label="All shopping lists"
        icon="format-list-checks"
        variant="ghost"
        size="sm"
        onPress={() => router.push('/inventory/shopping')}
        style={styles.left}
      />
      {actions.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  group: {
    gap: spacing.sm,
  },
  left: {
    alignSelf: 'flex-start',
  },
});
