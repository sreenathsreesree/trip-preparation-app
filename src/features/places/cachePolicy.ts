/**
 * How long provider content may be kept on the device.
 *
 * Design (to be confirmed against the current Google Maps Platform terms
 * before release): Google Place IDs may be stored indefinitely; latitude /
 * longitude may be cached for at most 30 consecutive days; other Places
 * content (name, address, types, ratings, photos, summaries) is treated as a
 * temporary cache with the same limit and is never pre-fetched. Ratings,
 * reviews and photos are not stored at all; they are shown live.
 *
 * What the user typed or chose stays permanently: the node's label, notes,
 * hierarchy and route. So a saved trip plan always works offline; only
 * provider details (coordinates, address) lapse until the next refresh.
 */
export const PROVIDER_CACHE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether provider content fetched at `fetchedAt` must be refreshed or dropped. */
export function isProviderContentExpired(fetchedAt: string | null, now: Date, days = PROVIDER_CACHE_DAYS): boolean {
  if (!fetchedAt) return false;
  const fetched = Date.parse(fetchedAt);
  if (Number.isNaN(fetched)) return true;
  return now.getTime() - fetched >= days * DAY_MS;
}

/** ISO timestamp before which provider content counts as expired. */
export function providerCacheCutoff(now: Date, days = PROVIDER_CACHE_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Days until expiry (0 once expired); null when there is nothing to expire. */
export function daysUntilRefresh(fetchedAt: string | null, now: Date, days = PROVIDER_CACHE_DAYS): number | null {
  if (!fetchedAt) return null;
  const fetched = Date.parse(fetchedAt);
  if (Number.isNaN(fetched)) return 0;
  return Math.max(0, Math.ceil((fetched + days * DAY_MS - now.getTime()) / DAY_MS));
}
