import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage } from '@/lib/imageStore';

import type { LoadStatus } from '../trips/tripsStore';
import {
  DEFAULT_FILTERS,
  type Availability,
  type CategoryInput,
  type InventoryCategory,
  type InventoryItemSummary,
  type ItemFilters,
  type ItemInput,
  type SortKey,
} from './model';

export type InventoryView = 'folders' | 'gallery' | 'list';

interface InventoryState {
  items: InventoryItemSummary[];
  categories: InventoryCategory[];
  status: LoadStatus;
  error: string | null;
  /** Shared by the folder, gallery and list views so they stay in sync. */
  view: InventoryView;
  filters: ItemFilters;
  sort: SortKey;
  load: () => Promise<void>;
  setView: (view: InventoryView) => void;
  setFilters: (patch: Partial<ItemFilters>) => void;
  setSort: (sort: SortKey) => void;
  createItem: (input: ItemInput) => Promise<InventoryItemSummary>;
  updateItem: (id: string, input: ItemInput) => Promise<InventoryItemSummary>;
  duplicateItem: (id: string) => Promise<InventoryItemSummary>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  setAvailability: (id: string, availability: Availability) => Promise<void>;
  adjustQuantity: (id: string, delta: number) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  createCategory: (input: CategoryInput) => Promise<InventoryCategory>;
  updateCategory: (id: string, input: CategoryInput) => Promise<InventoryCategory>;
  moveCategory: (id: string, direction: -1 | 1) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

/**
 * A category id the database no longer has means the list on screen is stale
 * (e.g. backup gave starter categories the cloud's ids): reload it so the form
 * shows the current categories, and ask the user to pick again.
 */
async function reloadOnStaleCategory(error: unknown): Promise<never> {
  if (error instanceof Error && /valid category|subcategory of the selected/.test(error.message)) {
    await useInventoryStore.getState().load();
    throw new Error('The category list was out of date and has been refreshed. Choose the category again.');
  }
  throw error;
}

export const useInventoryStore = accountScoped(create<InventoryState>()((set, get) => {
  /** Item usage (reserved/packed) depends on trips, so reload the whole list after writes. */
  async function refresh() {
    const { inventory } = await getRepositories();
    const [items, categories] = await Promise.all([inventory.listItems(), inventory.listCategories()]);
    set({ items, categories, status: 'ready', error: null });
  }

  return {
    items: [],
    categories: [],
    status: 'idle',
    error: null,
    view: 'folders',
    filters: DEFAULT_FILTERS,
    sort: 'name',

    async load() {
      set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null });
      try {
        await refresh();
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error, 'Could not load your inventory.') });
      }
    },

    setView: (view) => set({ view }),
    setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
    setSort: (sort) => set({ sort }),

    async createItem(input) {
      const { inventory } = await getRepositories();
      const item = await inventory.createItem(input).catch(reloadOnStaleCategory);
      await refresh();
      return item;
    },

    async updateItem(id, input) {
      const { inventory } = await getRepositories();
      const { item, orphanedImageUri } = await inventory.updateItem(id, input).catch(reloadOnStaleCategory);
      deleteStoredImage(orphanedImageUri);
      await refresh();
      return item;
    },

    async duplicateItem(id) {
      const { inventory } = await getRepositories();
      const copy = await inventory.duplicateItem(id);
      await refresh();
      return copy;
    },

    async setArchived(id, archived) {
      const { inventory } = await getRepositories();
      await inventory.setArchived(id, archived);
      await refresh();
    },

    async setAvailability(id, availability) {
      const { inventory } = await getRepositories();
      await inventory.setAvailability(id, availability);
      await refresh();
    },

    async adjustQuantity(id, delta) {
      const { inventory } = await getRepositories();
      await inventory.adjustQuantity(id, delta);
      await refresh();
    },

    async deleteItem(id) {
      const { inventory } = await getRepositories();
      const { orphanedImageUri } = await inventory.deleteItem(id);
      deleteStoredImage(orphanedImageUri);
      await refresh();
    },

    async createCategory(input) {
      const { inventory } = await getRepositories();
      const category = await inventory.createCategory(input);
      await refresh();
      return category;
    },

    async updateCategory(id, input) {
      const { inventory } = await getRepositories();
      const previous = get().categories.find((c) => c.id === id)?.coverImageUri ?? null;
      const category = await inventory.updateCategory(id, input);
      await refresh();
      if (previous && previous !== category.coverImageUri) {
        const stillUsed =
          get().items.some((i) => i.image?.uri === previous) ||
          get().categories.some((c) => c.coverImageUri === previous);
        if (!stillUsed) deleteStoredImage(previous);
      }
      return category;
    },

    async moveCategory(id, direction) {
      const { inventory } = await getRepositories();
      await inventory.moveCategory(id, direction);
      await refresh();
    },

    async deleteCategory(id) {
      const { inventory } = await getRepositories();
      const { orphanedImageUri } = await inventory.deleteCategory(id);
      deleteStoredImage(orphanedImageUri);
      await refresh();
    },
  };
}));

/** Category name lookup (categories and subcategories). */
export function categoryNameMap(categories: readonly InventoryCategory[]): Map<string, string> {
  return new Map(categories.map((c) => [c.id, c.name]));
}
