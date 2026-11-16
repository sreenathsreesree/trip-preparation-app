import { cachedFetch, type RemoteCacheRepository } from '../remote/remoteCacheRepository';
import type { DiscoveryCategory, DistanceKm, RecommendationSort } from './discovery';
import type { GeoPoint } from '../planner/model';
import { PlacesError, type PlaceDetails, type PlacesProvider } from './provider';

/**
 * Loads "Recommended nearby" for one destination, category and radius.
 *
 * - Google Places (through the proxy): Nearby Search for type-based categories (ranked by
 *   popularity, or by distance for "Nearest"), Text Search for the others (with further
 *   pages). Results are kept in memory for the session only — Google's terms do not allow
 *   storing names, ratings or photos on the device.
 * - Open map data (fallback provider): cached on the device for a week and reused when offline.
 *
 * Errors keep their kind (offline / network / quota / denied / not configured) so the screen
 * can tell a failure from a genuinely empty result.
 */

export const SESSION_CACHE_MS = 30 * 60 * 1000;
export const STORED_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 20;

export interface RecommendationPage {
  places: PlaceDetails[];
  nextPageToken: string | null;
  /** Where the page came from. */
  from: 'live' | 'cache' | 'stale_cache';
  fetchedAt: string | null;
}

export interface LoadRequest {
  category: DiscoveryCategory;
  location: GeoPoint;
  radiusKm: DistanceKm;
  sort: RecommendationSort;
  pageToken?: string | null;
}

export interface LoadDeps {
  provider: PlacesProvider;
  /** Device cache (for providers whose data may be stored). */
  cache?: RemoteCacheRepository | null;
  now?: () => Date;
  signal?: AbortSignal;
}

const memory = new Map<string, { at: number; page: RecommendationPage }>();

export function clearRecommendationCache() {
  memory.clear();
}

/** One key per centre (≈100 m), category, radius, ranking and page. */
export function recommendationKey(provider: PlacesProvider, r: LoadRequest): string {
  const rank = r.sort === 'distance' ? 'distance' : 'popularity';
  return ['rec', provider.source?.name ?? provider.id, r.category.key, `${r.location.latitude.toFixed(3)},${r.location.longitude.toFixed(3)}`, r.radiusKm, rank, r.pageToken ?? ''].join(':');
}

async function fetchPage(r: LoadRequest, deps: LoadDeps): Promise<{ places: PlaceDetails[]; nextPageToken: string | null }> {
  const { provider, signal } = deps;
  const radiusMeters = r.radiusKm * 1000;
  const rank = r.sort === 'distance' ? 'distance' : 'popularity';
  if (provider.discoverPage) {
    return provider.discoverPage(
      { selectors: r.category.osm, category: r.category.key, search: r.category.search, location: r.location, radiusMeters, maxResults: PAGE_SIZE, rank, pageToken: r.pageToken ?? null },
      signal,
    );
  }
  if (provider.discover) {
    return { places: await provider.discover({ selectors: r.category.osm, category: r.category.key, location: r.location, radiusMeters, maxResults: PAGE_SIZE }, signal), nextPageToken: null };
  }
  const search = r.category.search;
  const places =
    search.kind === 'nearby'
      ? await provider.nearby({ location: r.location, radiusMeters, includedTypes: search.includedTypes, maxResults: PAGE_SIZE, rank }, signal)
      : await provider.textSearch({ query: search.query, bias: r.location, radiusMeters, maxResults: PAGE_SIZE, rank: rank === 'distance' ? 'distance' : 'relevance' }, signal);
  return { places, nextPageToken: null };
}

/** A page of places for the request: session memory first, then the device cache (stored data only), then the provider. */
export async function loadRecommendations(r: LoadRequest, deps: LoadDeps): Promise<RecommendationPage> {
  if (!deps.provider.configured) throw new PlacesError('not_configured');
  const now = deps.now ?? (() => new Date());
  const key = recommendationKey(deps.provider, r);
  const held = memory.get(key);
  if (held && now().getTime() - held.at < SESSION_CACHE_MS) return { ...held.page, from: 'cache' };

  const storable = deps.provider.source?.storable === true;
  let page: RecommendationPage;
  if (storable && deps.cache) {
    const result = await cachedFetch(deps.cache, { key, kind: 'places', source: deps.provider.source?.name ?? '', maxAgeMs: STORED_CACHE_MS, now: now() }, () => fetchPage(r, deps));
    page = { ...result.payload, from: result.from, fetchedAt: result.fetchedAt };
  } else {
    try {
      page = { ...(await fetchPage(r, deps)), from: 'live', fetchedAt: now().toISOString() };
    } catch (error) {
      // Offline: what this session already loaded is still useful, clearly marked as older.
      if (held && error instanceof PlacesError && (error.kind === 'offline' || error.kind === 'network')) return { ...held.page, from: 'stale_cache' };
      throw error;
    }
  }
  // Results from Google are only ever held here, in memory.
  memory.set(key, { at: now().getTime(), page });
  return page;
}

/** Whether any of the places has a rating (Top rated is meaningful only then). */
export const hasRatings = (places: readonly PlaceDetails[]) => places.some((p) => typeof p.rating === 'number');

/** Plain-language explanation for an error kind (never a blank panel). */
export function describeRecommendationError(kind: string): { title: string; message: string; retry: boolean } {
  switch (kind) {
    case 'offline':
      return { title: 'You’re offline', message: 'Recommendations need a connection. Your plan still works offline.', retry: true };
    case 'network':
      return { title: 'Couldn’t reach the places service', message: 'The connection failed or the service didn’t answer. Try again.', retry: true };
    case 'quota':
      return { title: 'Recommendations are busy right now', message: 'The places service is over its limit for the moment. Try again in a little while.', retry: true };
    case 'denied':
      return { title: 'Recommendations were refused', message: 'The places service refused the request; its setup needs attention. You can still add places by name.', retry: false };
    case 'not_configured':
      return { title: 'Recommendations aren’t set up', message: 'This build has no places service. You can still add places by name.', retry: false };
    default:
      return { title: 'Couldn’t load recommendations', message: 'Something went wrong while searching nearby. Try again.', retry: true };
  }
}
