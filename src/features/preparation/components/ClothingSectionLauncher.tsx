import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { ErrorState, LoadingState } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';

import { tripOwner } from '../model';
import { useSectionExtrasStore } from '../sectionExtrasStore';

/**
 * The dashboard's Clothing entry: opens the trip's Clothing checklist section — the same
 * screen (tasks, groups, Add from Inventory) the Checklist tab opens — creating it the
 * first time. No second clothing list is kept anywhere.
 */
export function ClothingSectionLauncher({ tripId }: { tripId: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!tripId) return;
    let live = true;
    useSectionExtrasStore
      .getState()
      .ensureClothingSection(tripOwner(tripId))
      .then((sectionId) => live && router.replace({ pathname: '/trips/[tripId]/sections/[sectionId]', params: { tripId, sectionId } }))
      .catch((e: unknown) => live && setError(toErrorMessage(e, 'Could not open Clothing.')));
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
