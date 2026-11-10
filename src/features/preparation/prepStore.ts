import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { useTripsStore, type LoadStatus } from '../trips/tripsStore';
import { summarizeItems, type PrepItem, type PrepSectionId } from './model';

interface TripChecklist {
  status: LoadStatus;
  items: PrepItem[];
  error: string | null;
}

interface PrepState {
  byTrip: Record<string, TripChecklist>;
  loadTrip: (tripId: string) => Promise<void>;
  addItem: (tripId: string, section: PrepSectionId, title: string) => Promise<void>;
  /** Optimistic toggle; reverts and rethrows if the write fails. */
  toggleItem: (tripId: string, itemId: string) => Promise<void>;
  removeItem: (tripId: string, itemId: string) => Promise<void>;
  forgetTrip: (tripId: string) => void;
}

const EMPTY: TripChecklist = { status: 'idle', items: [], error: null };

export const usePrepStore = create<PrepState>()((set, get) => {
  function setItems(tripId: string, items: PrepItem[]) {
    set((state) => ({
      byTrip: { ...state.byTrip, [tripId]: { status: 'ready', items, error: null } },
    }));
    useTripsStore.getState().applyProgress(tripId, summarizeItems(items));
  }

  function itemsOf(tripId: string): PrepItem[] {
    return get().byTrip[tripId]?.items ?? [];
  }

  return {
    byTrip: {},

    async loadTrip(tripId) {
      const current = get().byTrip[tripId] ?? EMPTY;
      set((state) => ({
        byTrip: {
          ...state.byTrip,
          [tripId]: { ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: null },
        },
      }));
      try {
        const { prepItems } = await getRepositories();
        setItems(tripId, await prepItems.listByTrip(tripId));
      } catch (error) {
        set((state) => ({
          byTrip: {
            ...state.byTrip,
            [tripId]: {
              ...(state.byTrip[tripId] ?? EMPTY),
              status: 'error',
              error: toErrorMessage(error, 'Could not load this checklist.'),
            },
          },
        }));
      }
    },

    async addItem(tripId, section, title) {
      const { prepItems } = await getRepositories();
      const item = await prepItems.add(tripId, section, title);
      setItems(tripId, [...itemsOf(tripId), item]);
    },

    async toggleItem(tripId, itemId) {
      const previous = itemsOf(tripId);
      const target = previous.find((item) => item.id === itemId);
      if (!target) return;

      const nextDone = !target.isDone;
      setItems(
        tripId,
        previous.map((item) => (item.id === itemId ? { ...item, isDone: nextDone } : item)),
      );
      try {
        const { prepItems } = await getRepositories();
        await prepItems.setDone(itemId, nextDone);
      } catch (error) {
        // Revert only this item so concurrent edits to others are kept.
        setItems(
          tripId,
          itemsOf(tripId).map((item) =>
            item.id === itemId ? { ...item, isDone: target.isDone } : item,
          ),
        );
        throw error;
      }
    },

    async removeItem(tripId, itemId) {
      const { prepItems } = await getRepositories();
      await prepItems.remove(itemId);
      setItems(
        tripId,
        itemsOf(tripId).filter((item) => item.id !== itemId),
      );
    },

    forgetTrip(tripId) {
      set((state) => {
        const next = { ...state.byTrip };
        delete next[tripId];
        return { byTrip: next };
      });
    },
  };
});

export function useTripChecklist(tripId: string | undefined): TripChecklist {
  return usePrepStore((state) => (tripId ? state.byTrip[tripId] : undefined) ?? EMPTY);
}
