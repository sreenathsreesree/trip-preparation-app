import { useEffect, useMemo } from 'react';

import { colors } from '@/theme';
import type { IconName } from '@/theme/icons';

import { useInventoryStore } from './inventoryStore';
import {
  matchesFilters,
  sortItems,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemSummary,
  type ItemFilters,
  type SortKey,
} from './model';

export function useEnsureInventoryLoaded() {
  const status = useInventoryStore((state) => state.status);
  const load = useInventoryStore((state) => state.load);
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);
}

export interface CategoryMaps {
  byId: Map<string, InventoryCategory>;
  names: Map<string, string>;
  topLevel: InventoryCategory[];
  childrenOf: (parentId: string) => InventoryCategory[];
}

export function useCategoryMaps(): CategoryMaps {
  const categories = useInventoryStore((state) => state.categories);
  return useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const sorted = [...categories].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    return {
      byId,
      names: new Map(categories.map((c) => [c.id, c.name])),
      topLevel: sorted.filter((c) => !c.parentId),
      childrenOf: (parentId: string) => sorted.filter((c) => c.parentId === parentId),
    };
  }, [categories]);
}

/** Icon and colour used for an item's placeholder. */
export function placeholderFor(
  item: Pick<InventoryItem, 'categoryId'> | { categoryId: string | null },
  maps: CategoryMaps,
): { icon: IconName; color: string } {
  const category = item.categoryId ? maps.byId.get(item.categoryId) : undefined;
  return { icon: category?.icon ?? 'shape-outline', color: category?.color ?? colors.info };
}

/** Items after the shared search/filter/sort state. */
export function useVisibleItems(filters: ItemFilters, sort: SortKey): InventoryItemSummary[] {
  const items = useInventoryStore((state) => state.items);
  const maps = useCategoryMaps();
  return useMemo(
    () => sortItems(items.filter((item) => matchesFilters(item, filters, maps.names)), sort, maps.names),
    [items, filters, sort, maps.names],
  );
}
