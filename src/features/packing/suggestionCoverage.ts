import { coveringEntry } from './categories';
import type { PackingEntry, Recommendation } from './model';
import { suggestionKeywords } from './recommendations';

/**
 * Pending suggestions already represented by an item on the trip (same
 * inventory item, same name or a matching keyword, for the same traveller or
 * shared), mapped to that item. Entries linked to another suggestion do not count.
 */
export function coveredSuggestions(
  recommendations: readonly Recommendation[],
  entries: readonly PackingEntry[],
): Map<string, PackingEntry> {
  const linked = new Set(recommendations.map((r) => r.packingEntryId).filter((id): id is string => Boolean(id)));
  const result = new Map<string, PackingEntry>();
  for (const r of recommendations) {
    if (r.status !== 'pending') continue;
    const entry = coveringEntry(
      { name: r.name, keywords: suggestionKeywords(r.key), inventoryItemId: r.inventoryItemId, travellerId: r.travellerId },
      entries,
      linked,
    );
    if (entry) result.set(r.id, entry);
  }
  return result;
}
