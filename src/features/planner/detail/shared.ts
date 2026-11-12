import { useState } from 'react';

import { toErrorMessage } from '@/lib/errors';

import type { NodeProfile } from '../companion';
import type { CompanionRepository, NodeDetails } from '../companionRepository';
import { useDetailStore } from '../detailStore';
import type { PlanNode, TripPlan } from '../model';

/** Everything a section of the destination page needs. */
export interface DetailContext {
  tripId: string;
  node: PlanNode;
  plan: TripPlan;
  profile: NodeProfile;
  details: NodeDetails | null;
}

/**
 * Runs a companion write for the open place with a busy flag and a readable
 * error. Returns true when it worked.
 */
export function useDetailAction(tripId: string, nodeId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: (companion: CompanionRepository) => Promise<unknown>, fallback = 'Could not save that.') {
    setBusy(true);
    setError(null);
    try {
      await useDetailStore.getState().run(tripId, nodeId, fn);
      return true;
    } catch (err) {
      setError(toErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, act };
}

export const DETAIL_TABS = [
  { value: 'overview', label: 'Overview', icon: 'information-outline' },
  { value: 'explore', label: 'Explore', icon: 'compass-outline' },
  { value: 'prepare', label: 'Prepare', icon: 'clipboard-check-outline' },
  { value: 'plan', label: 'Plan', icon: 'calendar-clock-outline' },
  { value: 'memories', label: 'Memories', icon: 'image-multiple-outline' },
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number]['value'];
export const isDetailTab = (v: unknown): v is DetailTab => DETAIL_TABS.some((t) => t.value === v);
