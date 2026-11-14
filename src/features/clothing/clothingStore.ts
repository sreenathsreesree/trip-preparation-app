import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';
import type { IconName } from '@/theme/icons';

import type { NewEntryInput } from '../packing/model';
import { usePackingStore } from '../packing/packingStore';
import type { ClothingCategory } from './model';

export interface TripClothing {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  categories: ClothingCategory[];
  /** Packing entry id → clothing category id (null: clothing without a category). */
  links: Record<string, string | null>;
}

const EMPTY: TripClothing = { status: 'idle', error: null, categories: [], links: {} };

interface ClothingState {
  byTrip: Record<string, TripClothing>;
  load: (tripId: string) => Promise<void>;
  addCategory: (tripId: string, name: string, icon: IconName) => Promise<ClothingCategory>;
  updateCategory: (tripId: string, id: string, name: string, icon: IconName) => Promise<void>;
  removeCategory: (tripId: string, id: string, moveTo: string | null) => Promise<void>;
  /** Adds a clothing item: a packing entry (manual or from Inventory) in a category. */
  addItem: (tripId: string, categoryId: string | null, input: NewEntryInput) => Promise<string>;
  setCategory: (tripId: string, entryId: string, categoryId: string | null) => Promise<void>;
}

/** The trip's clothing categories and which packing entries are clothing. Items live in the packing store. */
export const useClothingStore = accountScoped(
  create<ClothingState>()((set, get) => {
    const put = (tripId: string, patch: Partial<TripClothing>) =>
      set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), ...patch } } }));

    async function refresh(tripId: string) {
      const { clothing } = await getRepositories();
      const [categories, links] = await Promise.all([clothing.categories(tripId), clothing.links(tripId)]);
      put(tripId, { status: 'ready', error: null, categories, links });
    }

    return {
      byTrip: {},

      async load(tripId) {
        put(tripId, { status: get().byTrip[tripId]?.status === 'ready' ? 'ready' : 'loading' });
        try {
          const { clothing } = await getRepositories();
          await clothing.ensureStarter(tripId);
          await Promise.all([refresh(tripId), usePackingStore.getState().load(tripId)]);
        } catch (err) {
          put(tripId, { status: 'error', error: err instanceof Error ? err.message : 'Could not load clothing.' });
        }
      },

      async addCategory(tripId, name, icon) {
        const { clothing } = await getRepositories();
        const category = await clothing.addCategory(tripId, { name, icon });
        await refresh(tripId);
        return category;
      },

      async updateCategory(tripId, id, name, icon) {
        const { clothing } = await getRepositories();
        await clothing.updateCategory(id, { name, icon });
        await refresh(tripId);
      },

      async removeCategory(tripId, id, moveTo) {
        const { clothing } = await getRepositories();
        await clothing.removeCategory(id, moveTo);
        await refresh(tripId);
      },

      async addItem(tripId, categoryId, input) {
        const entry = await usePackingStore.getState().addEntry(tripId, input);
        const { clothing } = await getRepositories();
        await clothing.link(tripId, entry.id, categoryId);
        await refresh(tripId);
        return entry.id;
      },

      async setCategory(tripId, entryId, categoryId) {
        const { clothing } = await getRepositories();
        await clothing.link(tripId, entryId, categoryId);
        await refresh(tripId);
      },
    };
  }),
);

export function useTripClothing(tripId: string | undefined): TripClothing {
  return useClothingStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? EMPTY);
}
