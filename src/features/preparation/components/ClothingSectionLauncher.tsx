import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { ErrorState, LoadingState } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';

import { useInventoryStore } from '../../inventory/inventoryStore';

/**
 * Every Clothing entry point (the dashboard tile and the old Clothing organiser links) opens the
 * Clothing category of the trip's Packing list — the single place for packing items.
 */
export function ClothingSectionLauncher({ tripId }: { tripId: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    let live = true;
    (async () => {
      const inventory = useInventoryStore.getState();
      if (inventory.status !== 'ready') await inventory.load();
      const clothing = useInventoryStore.getState().categories.find((c) => c.systemKey === 'clothing' && !c.parentId);
      if (!live) return;
      if (clothing) router.replace({ pathname: '/trips/[tripId]/packing/category/[categoryId]', params: { tripId, categoryId: clothing.id } });
      else router.replace({ pathname: '/trips/[tripId]/packing', params: { tripId } });
    })().catch((e: unknown) => live && setError(toErrorMessage(e, 'Could not open Clothing.')));
    return () => {
      live = false;
    };
  }, [tripId, attempt]);
  return (
    <Screen bottomInset testID="clothing-launcher">
      <ScreenHeader showBack title="Clothing" />
      {error ? <ErrorState message={error} onRetry={() => (setError(null), setAttempt((n) => n + 1))} /> : <LoadingState label="Opening Clothing…" />}
    </Screen>
  );
}
