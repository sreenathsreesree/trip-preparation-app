import { containsWord, normalizeName, type InventoryCategory } from '../inventory/model';
import type { PackingEntry } from './model';

/**
 * Two-level packing: entries grouped under the user's shared category tree.
 * Pure helpers (no database, no React) so grouping and progress are easy to test.
 */

/** Route key for entries without a (still existing) category. */
export const UNCATEGORISED = 'none';

export interface CategoryProgress {
  total: number;
  packed: number;
  remaining: number;
  /** Whole percent, 0 for an empty category. */
  percent: number;
}

/** Progress by item: "6 items · 4 packed · 2 remaining · 67%". */
export function categoryProgress(entries: readonly Pick<PackingEntry, 'isPacked'>[]): CategoryProgress {
  const total = entries.length;
  const packed = entries.filter((entry) => entry.isPacked).length;
  return { total, packed, remaining: total - packed, percent: total === 0 ? 0 : Math.round((packed / total) * 100) };
}

/**
 * The top-level category an entry belongs to. Entries in a subcategory roll up
 * to its parent; a missing (deleted) category means uncategorised.
 */
export function topLevelKey(
  categoryId: string | null,
  byId: ReadonlyMap<string, Pick<InventoryCategory, 'id' | 'parentId'>>,
): string {
  if (!categoryId) return UNCATEGORISED;
  const category = byId.get(categoryId);
  if (!category) return UNCATEGORISED;
  if (!category.parentId) return category.id;
  return byId.has(category.parentId) ? category.parentId : UNCATEGORISED;
}

export interface PackingCategoryGroup {
  /** Category id, or `UNCATEGORISED`. */
  key: string;
  category: InventoryCategory | null;
  entries: PackingEntry[];
  progress: CategoryProgress;
}

export interface GroupedPacking {
  /** Categories with items, in the user's category order; uncategorised last. */
  filled: PackingCategoryGroup[];
  /** Categories without items, in the user's category order. */
  empty: PackingCategoryGroup[];
}

export function groupByCategory(
  entries: readonly PackingEntry[],
  topLevel: readonly InventoryCategory[],
  byId: ReadonlyMap<string, InventoryCategory>,
): GroupedPacking {
  const buckets = new Map<string, PackingEntry[]>();
  for (const entry of entries) {
    const key = topLevelKey(entry.categoryId, byId);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  const filled: PackingCategoryGroup[] = [];
  const empty: PackingCategoryGroup[] = [];
  for (const category of topLevel) {
    const rows = buckets.get(category.id) ?? [];
    const group = { key: category.id, category, entries: rows, progress: categoryProgress(rows) };
    (rows.length > 0 ? filled : empty).push(group);
  }
  const loose = buckets.get(UNCATEGORISED);
  if (loose) filled.push({ key: UNCATEGORISED, category: null, entries: loose, progress: categoryProgress(loose) });
  return { filled, empty };
}

/** Entries shown on one category's screen (its subcategories included). */
export function entriesInCategory(
  entries: readonly PackingEntry[],
  key: string,
  byId: ReadonlyMap<string, Pick<InventoryCategory, 'id' | 'parentId'>>,
): PackingEntry[] {
  return entries.filter((entry) => topLevelKey(entry.categoryId, byId) === key);
}

/** Something that could be added: a catalogue item, a rule suggestion or an inventory item. */
export interface CoverageCandidate {
  name: string;
  keywords?: readonly string[];
  inventoryItemId?: string | null;
}

/**
 * True when a trip entry already represents the candidate: the same inventory
 * item, the same name, or a name containing one of its keywords.
 */
export function isCovered(
  candidate: CoverageCandidate,
  entries: readonly Pick<PackingEntry, 'name' | 'inventoryItemId'>[],
): boolean {
  const name = normalizeName(candidate.name);
  return entries.some(
    (entry) =>
      (candidate.inventoryItemId != null && entry.inventoryItemId === candidate.inventoryItemId) ||
      normalizeName(entry.name) === name ||
      (candidate.keywords ?? []).some((keyword) => containsWord(entry.name, keyword)),
  );
}
