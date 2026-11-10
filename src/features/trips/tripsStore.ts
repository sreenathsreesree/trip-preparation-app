import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { buildStarterChecklist } from '../preparation/templates';
import type { NewTripInput, PrepProgress, TripSummary } from './model';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TripsState {
  trips: TripSummary[];
  status: LoadStatus;
  error: string | null;
  /** Loads (or reloads) all trips from the local database. */
  load: () => Promise<void>;
  create: (input: NewTripInput, options: { withStarterChecklist: boolean }) => Promise<TripSummary>;
  remove: (id: string) => Promise<void>;
  /** Keeps list progress in sync after checklist edits without a full reload. */
  applyProgress: (tripId: string, progress: PrepProgress) => void;
}

function sortTrips(trips: TripSummary[]): TripSummary[] {
  return [...trips].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt),
  );
}

export const useTripsStore = create<TripsState>()((set, get) => ({
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

  async create(input, { withStarterChecklist }) {
    const { trips } = await getRepositories();
    const created = await trips.create(input, {
      starterItems: withStarterChecklist ? buildStarterChecklist(input) : [],
    });
    set((state) => ({ trips: sortTrips([...state.trips, created]) }));
    return created;
  },

  async remove(id) {
    const { trips } = await getRepositories();
    await trips.remove(id);
    set((state) => ({ trips: state.trips.filter((trip) => trip.id !== id) }));
  },

  applyProgress(tripId, progress) {
    set((state) => ({
      trips: state.trips.map((trip) => (trip.id === tripId ? { ...trip, progress } : trip)),
    }));
  },
}));

export const selectTripById = (id: string | undefined) => (state: TripsState) =>
  id ? state.trips.find((trip) => trip.id === id) : undefined;
