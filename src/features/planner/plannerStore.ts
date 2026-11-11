import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import type { LoadStatus } from '../trips/tripsStore';
import { useTripsStore } from '../trips/tripsStore';
import type { Place, TripPlan } from './model';
import type { AddNodeResult, NewNodeInput } from './plannerRepository';

export interface TripPlanState {
  status: LoadStatus;
  error: string | null;
  plan: TripPlan | null;
}

const EMPTY: TripPlanState = { status: 'idle', error: null, plan: null };

interface PlannerStoreState {
  byTrip: Record<string, TripPlanState>;
  /** Most recently opened active trip planner (Home's "continue planning"). */
  lastOpenedTripId: string | null;
  load: (tripId: string) => Promise<void>;
  addNode: (tripId: string, input: NewNodeInput) => Promise<AddNodeResult>;
  updateNode: (tripId: string, id: string, patch: { name?: string; notes?: string }) => Promise<void>;
  moveNode: (tripId: string, id: string, target: { parentId: string | null; index?: number }) => Promise<void>;
  promote: (tripId: string, id: string) => Promise<void>;
  removeNode: (tripId: string, id: string, mode: 'keepChildren' | 'withChildren') => Promise<void>;
  addRouteStop: (tripId: string, nodeId: string, index?: number) => Promise<void>;
  removeRouteStop: (tripId: string, nodeId: string) => Promise<void>;
  moveRouteStop: (tripId: string, nodeId: string, toIndex: number) => Promise<void>;
  savedPlaces: () => Promise<Place[]>;
  markOpened: (tripId: string) => Promise<void>;
  loadLastOpened: () => Promise<void>;
}

export const usePlannerStore = create<PlannerStoreState>()((set, get) => {
  const put = (tripId: string, patch: Partial<TripPlanState>) =>
    set((state) => ({ byTrip: { ...state.byTrip, [tripId]: { ...(state.byTrip[tripId] ?? EMPTY), ...patch } } }));

  async function refresh(tripId: string) {
    const { planner } = await getRepositories();
    put(tripId, { status: 'ready', error: null, plan: await planner.load(tripId) });
  }

  /**
   * Runs a write, then reloads the plan. Main destinations are the trip's
   * destinations, so hierarchy changes also refresh the trips list.
   */
  async function write<T>(tripId: string, fn: (repos: Awaited<ReturnType<typeof getRepositories>>) => Promise<T>, trips = true) {
    const repos = await getRepositories();
    try {
      return await fn(repos);
    } finally {
      await refresh(tripId).catch(() => undefined);
      if (trips) await useTripsStore.getState().load();
    }
  }

  return {
    byTrip: {},
    lastOpenedTripId: null,

    async load(tripId) {
      const current = get().byTrip[tripId] ?? EMPTY;
      put(tripId, { status: current.plan ? 'ready' : 'loading', error: null });
      try {
        await refresh(tripId);
      } catch (error) {
        put(tripId, { status: 'error', error: toErrorMessage(error, 'Could not load the plan.') });
      }
    },

    addNode: (tripId, input) => write(tripId, ({ planner }) => planner.addNode(tripId, input)),
    updateNode: (tripId, id, patch) =>
      write(tripId, async ({ planner }) => {
        await planner.updateNode(id, patch);
      }),
    moveNode: (tripId, id, target) => write(tripId, ({ planner }) => planner.moveNode(id, target)),
    promote: (tripId, id) => write(tripId, ({ planner }) => planner.promote(id)),
    removeNode: (tripId, id, mode) => write(tripId, ({ planner }) => planner.removeNode(id, mode)),
    addRouteStop: (tripId, nodeId, index) =>
      write(tripId, ({ planner }) => planner.addRouteStop(tripId, nodeId, index), false),
    removeRouteStop: (tripId, nodeId) => write(tripId, ({ planner }) => planner.removeRouteStop(tripId, nodeId), false),
    moveRouteStop: (tripId, nodeId, toIndex) =>
      write(tripId, ({ planner }) => planner.moveRouteStop(tripId, nodeId, toIndex), false),

    async savedPlaces() {
      const { planner } = await getRepositories();
      return planner.listPlaces();
    },

    async markOpened(tripId) {
      const { planner } = await getRepositories();
      await planner.markOpened(tripId);
      set({ lastOpenedTripId: tripId });
    },

    async loadLastOpened() {
      const { planner } = await getRepositories();
      set({ lastOpenedTripId: await planner.lastOpenedTripId() });
    },
  };
});

export function useTripPlan(tripId: string | undefined): TripPlanState {
  return usePlannerStore((state) => (tripId ? state.byTrip[tripId] : undefined) ?? EMPTY);
}
