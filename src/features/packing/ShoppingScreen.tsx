import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { EmptyState, ErrorState, LoadingState, Notice, SegmentedControl } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';

import { useEnsureInventoryLoaded } from '../inventory/hooks';
import { PurchaseGroups } from './components/BuyTab';
import { usePurchaseActions } from './components/PurchaseActions';
import { usePackingStore } from './packingStore';

type Scope = 'open' | 'all';

/**
 * Every trip's shopping list in one place, including the history of trips
 * that have since been deleted.
 */
export function ShoppingScreen() {
  useEnsureInventoryLoaded();
  const purchases = usePackingStore((state) => state.allPurchases);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('open');
  const actions = usePurchaseActions();

  const load = useCallback(() => {
    usePackingStore
      .getState()
      .loadAllPurchases()
      .then(() => setStatus('ready'))
      .catch((err: unknown) => {
        setError(toErrorMessage(err, 'Could not load shopping lists.'));
        setStatus('error');
      });
  }, []);
  useFocusEffect(load);

  // Still to buy, or bought but not yet added to the inventory or a packing list.
  const open = purchases.filter(
    (p) => p.status === 'needed' || (p.status === 'purchased' && !p.inventoryItemId && !p.packingEntryId),
  );
  const visible = scope === 'open' ? open : purchases;

  return (
    <Screen testID="shopping-screen" bottomInset onRefresh={load}>
      <ScreenHeader
        showBack
        eyebrow="Inventory"
        title="Shopping list"
        subtitle={`${purchases.filter((p) => p.status === 'needed').length} to buy across your trips`}
      />
      <SegmentedControl
        options={[
          { value: 'open', label: `To do (${open.length})` },
          { value: 'all', label: `History (${purchases.length})` },
        ]}
        value={scope}
        onChange={setScope}
        accessibilityLabel="Shopping list scope"
      />
      {actions.error ? <Notice tone="danger" title="Not updated" message={actions.error} /> : null}
      {actions.notice ? <Notice tone="success" title={actions.notice} /> : null}
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load shopping lists.'} onRetry={load} />
      ) : status === 'loading' ? (
        <LoadingState label="Loading shopping lists…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title={scope === 'open' ? 'Nothing to buy' : 'No shopping history yet'}
          message="Items you need for a trip are added from its packing screen (Buy tab or a suggestion)."
        />
      ) : (
        <PurchaseGroups purchases={visible} showTrip onOpen={actions.open} />
      )}
      {actions.sheet}
    </Screen>
  );
}
