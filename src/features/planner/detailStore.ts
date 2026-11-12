import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import type { CompanionRepository, NodeDetails } from './companionRepository';
import { usePlannerStore } from './plannerStore';

/**
 * The open destination's own information (tasks, notes, saved notices,
 * memories, profile). Every write goes through the companion repository and
 * then reloads both the details and the trip plan, so the planner, route and
 * Navigation tabs stay in step.
 */
interface DetailState {
  byNode: Record<string, NodeDetails>;
  errors: Record<string, string | null>;
  load: (nodeId: string) => Promise<void>;
  /** Runs a companion write for a place, then reloads. Rethrows so screens can show the message. */
  run: <T>(tripId: string, nodeId: string, fn: (companion: CompanionRepository) => Promise<T>) => Promise<T>;
}

export const useDetailStore = create<DetailState>()((set) => {
  async function reload(nodeId: string) {
    const { companion } = await getRepositories();
    const details = await companion.node(nodeId);
    set((s) => ({ byNode: { ...s.byNode, [nodeId]: details }, errors: { ...s.errors, [nodeId]: null } }));
  }
  return {
    byNode: {},
    errors: {},
    async load(nodeId) {
      try {
        await reload(nodeId);
      } catch (error) {
        set((s) => ({ errors: { ...s.errors, [nodeId]: toErrorMessage(error, 'Could not load this place.') } }));
      }
    },
    async run(tripId, nodeId, fn) {
      const { companion } = await getRepositories();
      try {
        return await fn(companion);
      } finally {
        await reload(nodeId).catch(() => undefined);
        await usePlannerStore.getState().load(tripId);
      }
    },
  };
});

export function useNodeDetails(nodeId: string | undefined) {
  const details = useDetailStore((s) => (nodeId ? s.byNode[nodeId] : undefined));
  const error = useDetailStore((s) => (nodeId ? s.errors[nodeId] : null));
  return { details: details ?? null, error: error ?? null };
}
