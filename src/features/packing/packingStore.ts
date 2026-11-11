import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { useInventoryStore } from '../inventory/inventoryStore';
import type { LoadStatus } from '../trips/tripsStore';
import {
  DEFAULT_PREFERENCES,
  type EntryPatch,
  type Luggage,
  type LuggageKind,
  type NewEntryInput,
  type PackingEntry,
  type PurchaseItem,
  type PurchaseStatus,
  type Recommendation,
  type RegenerationPlan,
  type ReservationConflict,
  type TripPackingState,
  type UserPreferences,
} from './model';

export interface TripPacking {
  status: LoadStatus;
  error: string | null;
  state: TripPackingState | null;
  entries: PackingEntry[];
  luggage: Luggage[];
  recommendations: Recommendation[];
  purchases: PurchaseItem[];
}

const EMPTY: TripPacking = {
  status: 'idle',
  error: null,
  state: null,
  entries: [],
  luggage: [],
  recommendations: [],
  purchases: [],
};

interface PackingStoreState {
  byTrip: Record<string, TripPacking>;
  preferences: UserPreferences;
  /** Every purchase across trips, including those of deleted trips. */
  allPurchases: PurchaseItem[];
  load: (tripId: string) => Promise<void>;
  loadPreferences: () => Promise<void>;
  setPreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  updateProfile: (
    tripId: string,
    patch: Partial<Pick<TripPackingState, 'activities' | 'accommodation' | 'laundry'>>,
  ) => Promise<void>;
  addEntry: (tripId: string, input: NewEntryInput) => Promise<PackingEntry>;
  addEntries: (tripId: string, inputs: readonly NewEntryInput[]) => Promise<void>;
  updateEntry: (tripId: string, entryId: string, patch: EntryPatch) => Promise<void>;
  /** Optimistic packed toggle; reverts and rethrows on failure. */
  togglePacked: (tripId: string, entryId: string) => Promise<void>;
  removeEntry: (tripId: string, entryId: string) => Promise<void>;
  addLuggage: (tripId: string, kind: LuggageKind, name?: string) => Promise<Luggage>;
  updateLuggage: (tripId: string, id: string, input: { name: string; travellerId: string | null }) => Promise<void>;
  /** Saves a bag's name/owner and exactly which entries it holds. */
  saveBag: (
    tripId: string,
    id: string,
    input: { name: string; travellerId: string | null },
    entryIds: readonly string[],
  ) => Promise<void>;
  removeLuggage: (tripId: string, id: string) => Promise<void>;
  checkConflicts: (tripId: string) => Promise<ReservationConflict[]>;
  confirm: (tripId: string) => Promise<ReservationConflict[]>;
  unconfirm: (tripId: string) => Promise<void>;
  dismissDraftReason: (tripId: string) => Promise<void>;
  availability: (tripId: string, itemIds: readonly string[]) => Promise<Record<string, number>>;
  previewSuggestions: (tripId: string) => Promise<{ plan: RegenerationPlan; firstRun: boolean }>;
  applySuggestions: (tripId: string) => Promise<RegenerationPlan>;
  acceptSuggestions: (tripId: string, ids: readonly string[]) => Promise<number>;
  rejectSuggestion: (tripId: string, id: string) => Promise<void>;
  restoreSuggestion: (tripId: string, id: string) => Promise<void>;
  suggestionToPurchase: (tripId: string, id: string) => Promise<{ duplicate: boolean }>;
  addPurchase: (tripId: string, name: string, quantity: number, categoryId: string | null) => Promise<{ duplicate: boolean }>;
  setPurchaseStatus: (tripId: string | null, id: string, status: PurchaseStatus) => Promise<void>;
  setPurchaseQuantity: (tripId: string | null, id: string, quantity: number) => Promise<void>;
  removePurchase: (tripId: string | null, id: string) => Promise<void>;
  purchaseToInventory: (tripId: string | null, id: string) => Promise<void>;
  purchaseToTrip: (tripId: string, id: string) => Promise<void>;
  /** "Need to buy" for an item on the trip's list; never creates a duplicate purchase. */
  needToBuy: (tripId: string, entryId: string) => Promise<{ duplicate: boolean }>;
  loadAllPurchases: () => Promise<void>;
}

export const usePackingStore = create<PackingStoreState>()((set, get) => {
  const entryOf = (tripId: string) => get().byTrip[tripId] ?? EMPTY;
  const put = (tripId: string, patch: Partial<TripPacking>) =>
    set((state) => ({ byTrip: { ...state.byTrip, [tripId]: { ...(state.byTrip[tripId] ?? EMPTY), ...patch } } }));

  async function refresh(tripId: string) {
    const { packing, recommendations, purchases } = await getRepositories();
    const [overview, recs, buys] = await Promise.all([
      packing.load(tripId),
      recommendations.list(tripId),
      purchases.list(tripId),
    ]);
    put(tripId, {
      status: 'ready',
      error: null,
      state: overview.state,
      entries: overview.entries,
      luggage: overview.luggage,
      recommendations: recs,
      purchases: buys,
    });
  }

  /** Writes can change inventory usage (reserved/packed), so keep the inventory in sync too. */
  async function after(tripId: string | null, options: { inventory?: boolean } = {}) {
    if (tripId) await refresh(tripId);
    if (options.inventory) await useInventoryStore.getState().load();
    if (get().allPurchases.length > 0) await get().loadAllPurchases();
  }

  return {
    byTrip: {},
    preferences: DEFAULT_PREFERENCES,
    allPurchases: [],

    async load(tripId) {
      const current = entryOf(tripId);
      put(tripId, { status: current.status === 'ready' ? 'ready' : 'loading', error: null });
      try {
        await refresh(tripId);
      } catch (error) {
        put(tripId, { status: 'error', error: toErrorMessage(error, 'Could not load the packing list.') });
      }
    },

    async loadPreferences() {
      const { preferences } = await getRepositories();
      set({ preferences: await preferences.get() });
    },

    async setPreferences(patch) {
      const { preferences } = await getRepositories();
      set({ preferences: await preferences.set(patch) });
    },

    async updateProfile(tripId, patch) {
      const { packing } = await getRepositories();
      await packing.updateProfile(tripId, patch);
      await after(tripId);
    },

    async addEntry(tripId, input) {
      const { packing } = await getRepositories();
      const entry = await packing.addEntry(tripId, input);
      await after(tripId, { inventory: Boolean(input.inventoryItemId) });
      return entry;
    },

    async addEntries(tripId, inputs) {
      const { packing } = await getRepositories();
      await packing.addEntries(tripId, inputs);
      await after(tripId, { inventory: true });
    },

    async updateEntry(tripId, entryId, patch) {
      const { packing } = await getRepositories();
      await packing.updateEntry(entryId, patch);
      await after(tripId, { inventory: true });
    },

    async togglePacked(tripId, entryId) {
      const current = entryOf(tripId);
      const target = current.entries.find((e) => e.id === entryId);
      if (!target) return;
      const withValue = (isPacked: boolean) =>
        entryOf(tripId).entries.map((e) => (e.id === entryId ? { ...e, isPacked } : e));
      put(tripId, { entries: withValue(!target.isPacked) });
      try {
        const { packing } = await getRepositories();
        await packing.updateEntry(entryId, { isPacked: !target.isPacked });
        if (target.inventoryItemId) void useInventoryStore.getState().load();
      } catch (error) {
        put(tripId, { entries: withValue(target.isPacked) });
        throw error;
      }
    },

    async removeEntry(tripId, entryId) {
      const { packing } = await getRepositories();
      await packing.removeEntry(entryId);
      await after(tripId, { inventory: true });
    },

    async addLuggage(tripId, kind, name) {
      const { packing } = await getRepositories();
      const bag = await packing.addLuggage(tripId, { kind, name });
      await after(tripId);
      return bag;
    },

    async updateLuggage(tripId, id, input) {
      const { packing } = await getRepositories();
      await packing.updateLuggage(id, input);
      await after(tripId);
    },

    async saveBag(tripId, id, input, entryIds) {
      const { packing } = await getRepositories();
      await packing.updateLuggage(id, input);
      await packing.setLuggageContents(id, entryIds);
      await after(tripId);
    },

    async removeLuggage(tripId, id) {
      const { packing } = await getRepositories();
      await packing.removeLuggage(id);
      await after(tripId);
    },

    async checkConflicts(tripId) {
      const { packing } = await getRepositories();
      return packing.checkConflicts(tripId);
    },

    async confirm(tripId) {
      const { packing } = await getRepositories();
      const result = await packing.confirm(tripId);
      await after(tripId, { inventory: true });
      return result.ok ? [] : result.conflicts;
    },

    async unconfirm(tripId) {
      const { packing } = await getRepositories();
      await packing.unconfirm(tripId);
      await after(tripId, { inventory: true });
    },

    async dismissDraftReason(tripId) {
      const { packing } = await getRepositories();
      await packing.dismissDraftReason(tripId);
      await after(tripId);
    },

    async availability(tripId, itemIds) {
      const { packing } = await getRepositories();
      return packing.availability(tripId, itemIds);
    },

    async previewSuggestions(tripId) {
      const { recommendations } = await getRepositories();
      const { plan, firstRun } = await recommendations.preview(tripId);
      return { plan, firstRun };
    },

    async applySuggestions(tripId) {
      const { recommendations } = await getRepositories();
      const plan = await recommendations.apply(tripId);
      await after(tripId);
      return plan;
    },

    async acceptSuggestions(tripId, ids) {
      const { recommendations } = await getRepositories();
      const count = await recommendations.accept(ids);
      await after(tripId, { inventory: true });
      return count;
    },

    async rejectSuggestion(tripId, id) {
      const { recommendations } = await getRepositories();
      await recommendations.reject(id);
      await after(tripId);
    },

    async restoreSuggestion(tripId, id) {
      const { recommendations } = await getRepositories();
      await recommendations.restore(id);
      await after(tripId);
    },

    async suggestionToPurchase(tripId, id) {
      const { recommendations } = await getRepositories();
      const result = await recommendations.addToPurchaseList(id);
      await after(tripId);
      return result;
    },

    async needToBuy(tripId, entryId) {
      const { purchases } = await getRepositories();
      const { duplicate } = await purchases.addForEntry(entryId);
      await after(tripId);
      return { duplicate };
    },

    async addPurchase(tripId, name, quantity, categoryId) {
      const { purchases } = await getRepositories();
      const { duplicate } = await purchases.add(tripId, { name, quantity, categoryId });
      await after(tripId);
      return { duplicate };
    },

    async setPurchaseStatus(tripId, id, status) {
      const { purchases } = await getRepositories();
      await purchases.setStatus(id, status);
      await after(tripId);
    },

    async setPurchaseQuantity(tripId, id, quantity) {
      const { purchases } = await getRepositories();
      await purchases.setQuantity(id, quantity);
      await after(tripId);
    },

    async removePurchase(tripId, id) {
      const { purchases } = await getRepositories();
      await purchases.remove(id);
      await after(tripId);
    },

    async purchaseToInventory(tripId, id) {
      const { purchases } = await getRepositories();
      await purchases.addToInventory(id);
      await after(tripId, { inventory: true });
    },

    async purchaseToTrip(tripId, id) {
      const { purchases } = await getRepositories();
      await purchases.addToTrip(id);
      await after(tripId, { inventory: true });
    },

    async loadAllPurchases() {
      const { purchases } = await getRepositories();
      set({ allPurchases: await purchases.list() });
    },
  };
});

export function useTripPacking(tripId: string | undefined): TripPacking {
  return usePackingStore((state) => (tripId ? state.byTrip[tripId] : undefined) ?? EMPTY);
}
