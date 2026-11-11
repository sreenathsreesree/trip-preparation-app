import { normalizeName, type CategoryKey, type InventoryCategory, type InventoryItemSummary } from '../inventory/model';
import { PACKING_CATALOGUE, type CatalogueItem } from './catalogue';
import { isCovered, topLevelKey } from './categories';
import type { PackingEntry } from './model';

/**
 * What can be added to a trip from a category: things you own, default
 * suggestions and trip-only items. Pure functions; nothing is ever added
 * without the user choosing it.
 */

type CategoryLookup = ReadonlyMap<string, Pick<InventoryCategory, 'id' | 'parentId'>>;

export function matchesQuery(name: string, query: string): boolean {
  const q = normalizeName(query);
  return q.length === 0 || normalizeName(name).includes(q);
}

/** Why an inventory item cannot be packed right now, if it cannot. */
export function blockedReason(item: Pick<InventoryItemSummary, 'availability' | 'quantity' | 'archivedAt'>): string | null {
  if (item.archivedAt) return 'Archived';
  if (item.availability === 'damaged') return 'Marked damaged';
  if (item.availability === 'borrowed') return 'Lent out';
  if (item.quantity === 0) return 'None owned';
  return null;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Inventory for the add screen. With a category, its own items come first
 * (`here`); other items appear only while searching (`elsewhere`).
 */
export function inventoryChoices(
  items: readonly InventoryItemSummary[],
  categoryKey: string | null,
  byId: CategoryLookup,
  query: string,
): { here: InventoryItemSummary[]; elsewhere: InventoryItemSummary[] } {
  const active = items.filter((item) => !item.archivedAt && matchesQuery(item.name, query));
  if (categoryKey === null) return { here: [...active].sort(byName), elsewhere: [] };
  const here = active.filter((item) => topLevelKey(item.categoryId, byId) === categoryKey).sort(byName);
  const elsewhere = query.trim() ? active.filter((item) => !here.includes(item)).sort(byName) : [];
  return { here, elsewhere };
}

export interface SuggestionChoice extends CatalogueItem {
  /** Starter category the suggestion belongs to. */
  categoryKey: CategoryKey;
}

/**
 * Default suggestions not yet represented on the trip. A category shows its own
 * catalogue; without a category (or for a custom one) suggestions from every
 * category appear only while searching. Suggestions matching an owned item that
 * is shown alongside (`owned`) are left out, so the owned item is picked instead.
 */
export function suggestionChoices(
  systemKey: CategoryKey | null,
  entries: readonly Pick<PackingEntry, 'name' | 'inventoryItemId'>[],
  query: string,
  owned: readonly Pick<InventoryItemSummary, 'id' | 'name'>[] = [],
): SuggestionChoice[] {
  const covering = [...entries, ...owned.map((item) => ({ name: item.name, inventoryItemId: item.id }))];
  const keys: CategoryKey[] = systemKey ? [systemKey] : query.trim() ? (Object.keys(PACKING_CATALOGUE) as CategoryKey[]) : [];
  const seen = new Set<string>();
  const result: SuggestionChoice[] = [];
  for (const key of keys) {
    for (const item of PACKING_CATALOGUE[key]) {
      const name = normalizeName(item.name);
      if (seen.has(name) || !matchesQuery(item.name, query) || isCovered(item, covering)) continue;
      seen.add(name);
      result.push({ ...item, categoryKey: key });
    }
  }
  return result;
}

/** Owned items in a category that are not on the trip yet and can be packed (for one-tap adding). */
export function quickInventory(
  items: readonly InventoryItemSummary[],
  categoryKey: string,
  byId: CategoryLookup,
  entries: readonly Pick<PackingEntry, 'inventoryItemId'>[],
): InventoryItemSummary[] {
  const onTrip = new Set(entries.map((entry) => entry.inventoryItemId).filter(Boolean));
  return items
    .filter((item) => topLevelKey(item.categoryId, byId) === categoryKey && !onTrip.has(item.id) && !blockedReason(item))
    .sort(byName);
}

/** True when the typed text is worth offering as a new trip-only item. */
export function canCreate(query: string, existingNames: readonly string[]): boolean {
  const q = normalizeName(query);
  return q.length > 0 && !existingNames.some((name) => normalizeName(name) === q);
}
