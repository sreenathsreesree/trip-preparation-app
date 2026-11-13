import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { mergePlans, standardSectionsPlan } from '../preparation/model';
import type { ReadinessStats } from '../preparation/readiness';
import { buildStarterChecklist } from '../preparation/starter';
import type { TripInput, TripSummary } from './model';
import type { DeletionImpact } from './tripRepository';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CreateTripOptions {
  /** Pre-fill the standard sections with the recommended starter tasks. */
  withStarterChecklist: boolean;
  /** Templates whose sections and tasks are copied into the new trip. */
  templateIds?: readonly string[];
}

interface TripsState {
  trips: TripSummary[];
  status: LoadStatus;
  error: string | null;
  /** Loads (or reloads) all trips from the local database. */
  load: () => Promise<void>;
  create: (input: TripInput, options: CreateTripOptions) => Promise<TripSummary>;
  update: (id: string, input: TripInput) => Promise<TripSummary>;
  duplicate: (id: string) => Promise<TripSummary>;
  setCompleted: (id: string, completed: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  deletionImpact: (id: string) => Promise<DeletionImpact>;
  /** Keeps list readiness in sync after checklist edits without a full reload. */
  applyReadiness: (tripId: string, readiness: ReadinessStats) => void;
}

function sortTrips(trips: TripSummary[]): TripSummary[] {
  return [...trips].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt),
  );
}

export const useTripsStore = accountScoped(create<TripsState>()((set, get) => {
  const upsert = (trip: TripSummary) =>
    set((state) => ({
      trips: sortTrips([...state.trips.filter((existing) => existing.id !== trip.id), trip]),
    }));

  return {
    trips: [],
    status: 'idle',
    error: null,

    async load() {
      // Keep showing existing data while refreshing.
      set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null });
      try {
        const { trips } = await getRepositories();
        set({ trips: await trips.list(), status: 'ready', error: null });
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error, 'Could not load your trips.') });
      }
    },

    async create(input, { withStarterChecklist, templateIds = [] }) {
      const { trips, templates } = await getRepositories();
      const base = withStarterChecklist
        ? buildStarterChecklist(input)
        : standardSectionsPlan(input.transportMode);
      const templatePlans = await Promise.all(templateIds.map((id) => templates.toPlan(id)));
      const created = await trips.create(input, mergePlans(base, ...templatePlans));
      upsert(created);
      return created;
    },

    async update(id, input) {
      const { trips } = await getRepositories();
      const updated = await trips.update(id, input);
      upsert(updated);
      return updated;
    },

    async duplicate(id) {
      const { trips } = await getRepositories();
      const copy = await trips.duplicate(id);
      upsert(copy);
      return copy;
    },

    async setCompleted(id, completed) {
      const { trips } = await getRepositories();
      upsert(await trips.setCompleted(id, completed));
    },

    async setArchived(id, archived) {
      const { trips } = await getRepositories();
      upsert(await trips.setArchived(id, archived));
    },

    async remove(id) {
      const { trips } = await getRepositories();
      await trips.remove(id);
      set((state) => ({ trips: state.trips.filter((trip) => trip.id !== id) }));
    },

    async deletionImpact(id) {
      const { trips } = await getRepositories();
      return trips.deletionImpact(id);
    },

    applyReadiness(tripId, readiness) {
      set((state) => ({
        trips: state.trips.map((trip) => (trip.id === tripId ? { ...trip, readiness } : trip)),
      }));
    },
  };
}));

export const selectTripById = (id: string | undefined) => (state: TripsState) =>
  id ? state.trips.find((trip) => trip.id === id) : undefined;
