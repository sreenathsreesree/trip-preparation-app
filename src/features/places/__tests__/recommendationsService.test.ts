import { setupRepositories } from '../../../../test/fixtures';
import { createRemoteCacheRepository } from '../../remote/remoteCacheRepository';
import { DISCOVERY_CATEGORIES, DISTANCE_FILTERS_KM, rankRecommendations } from '../discovery';
import { PlacesError, type PlaceDetails, type PlacesProvider } from '../provider';
import { createProxyProvider } from '../proxyProvider';
import { clearRecommendationCache, describeRecommendationError, hasRatings, loadRecommendations, SESSION_CACHE_MS } from '../recommendationsService';

const MUNNAR = { latitude: 10.0889, longitude: 77.0595 };
const cat = (key: string) => DISCOVERY_CATEGORIES.find((c) => c.key === key)!;

function place(id: string, name: string, location: { latitude: number; longitude: number } | null, rating: number | null = null, count: number | null = null): PlaceDetails {
  return { provider: 'google', providerPlaceId: id, name, location, formattedAddress: '', types: [], district: null, state: null, country: null, metadata: {}, rating, userRatingCount: count, editorialSummary: null, photos: [], mapsUri: null, attributions: [] };
}

/** Fake proxy: records request bodies per path. */
function proxy(handler: (path: string, body: Record<string, unknown>) => { status?: number; json: unknown } | Promise<never>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, body });
    const r = await handler(path, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { provider: createProxyProvider('https://proxy.example', fetchImpl), calls };
}

const PLACES = [
  { providerPlaceId: 'a', name: 'Attukad Waterfalls', location: { latitude: 10.0534, longitude: 77.0588 }, rating: 4.3, userRatingCount: 5000 },
  { providerPlaceId: 'b', name: 'Lakkam Waterfalls', location: { latitude: 10.2483, longitude: 77.1544 }, rating: 4.6, userRatingCount: 900 },
  { providerPlaceId: 'c', name: 'Nameless Falls', location: { latitude: 10.09, longitude: 77.06 }, rating: null, userRatingCount: null },
];

beforeEach(clearRecommendationCache);

describe('Recommended nearby (Google Places through the proxy)', () => {
  it('uses Nearby Search for type categories and Text Search for the others, centred on the destination', async () => {
    const { provider, calls } = proxy(() => ({ json: { places: [] } }));
    for (const key of ['attractions', 'viewpoints', 'waterfalls', 'nature']) {
      await loadRecommendations({ category: cat(key), location: MUNNAR, radiusKm: 10, sort: 'relevance' }, { provider });
    }
    expect(calls.map((c) => c.path)).toEqual(['/nearby', '/text', '/text', '/nearby']);
    expect(calls[0]?.body).toMatchObject({ location: MUNNAR, radiusMeters: 10000, includedTypes: ['tourist_attraction', 'museum', 'historical_landmark'], rankPreference: 'POPULARITY' });
    expect(calls[1]?.body).toMatchObject({ query: 'viewpoint', bias: MUNNAR, radiusMeters: 10000, rankPreference: 'RELEVANCE' });
    expect(calls[2]?.body).toMatchObject({ query: 'waterfall' });
    expect(calls[3]?.body).toMatchObject({ includedTypes: ['park', 'national_park', 'hiking_area'] });
  });

  it('applies each radius (5, 10, 25, 50 km) and keeps results inside it', async () => {
    const { provider, calls } = proxy(() => ({ json: { places: PLACES } }));
    const counts: number[] = [];
    for (const km of DISTANCE_FILTERS_KM) {
      const page = await loadRecommendations({ category: cat('waterfalls'), location: MUNNAR, radiusKm: km, sort: 'relevance' }, { provider });
      counts.push(rankRecommendations(page.places, MUNNAR, km, new Set(), 'relevance').length);
    }
    expect(calls.map((c) => c.body.radiusMeters)).toEqual([5000, 10000, 25000, 50000]);
    // Lakkam is ~24 km away; Attukad ~4 km; Nameless ~0.2 km.
    expect(counts).toEqual([2, 2, 3, 3]);
  });

  it('“Nearest” asks for distance ranking and sorts by real distance', async () => {
    const { provider, calls } = proxy(() => ({ json: { places: PLACES } }));
    const page = await loadRecommendations({ category: cat('waterfalls'), location: MUNNAR, radiusKm: 50, sort: 'distance' }, { provider });
    expect(calls[0]?.body.rankPreference).toBe('DISTANCE');
    const recs = rankRecommendations(page.places, MUNNAR, 50, new Set(), 'distance');
    expect(recs.map((r) => r.place.name)).toEqual(['Nameless Falls', 'Attukad Waterfalls', 'Lakkam Waterfalls']);
    expect(recs[1]?.distanceMeters).toBeGreaterThan(3500);
    expect(recs[1]?.distanceMeters).toBeLessThan(4500);
  });

  it('“Top rated” uses ratings weighted by review count; unrated places go last and nothing is invented', () => {
    const list = PLACES.map((p) => place(p.providerPlaceId, p.name, p.location, p.rating, p.userRatingCount));
    const recs = rankRecommendations(list, MUNNAR, 50, new Set(), 'rating');
    expect(recs.map((r) => r.place.name)).toEqual(['Attukad Waterfalls', 'Lakkam Waterfalls', 'Nameless Falls']);
    expect(recs[2]?.place.rating).toBeNull();
    expect(hasRatings(list)).toBe(true);
    expect(hasRatings([place('x', 'X', null)])).toBe(false);
    // A place without coordinates has no distance (never guessed).
    expect(rankRecommendations([place('x', 'X', null)], MUNNAR, 5, new Set())[0]?.distanceMeters).toBeNull();
  });

  it('pages through Text Search results', async () => {
    const { provider, calls } = proxy((_, body) => ({ json: body.pageToken ? { places: [PLACES[1]], nextPageToken: null } : { places: [PLACES[0]], nextPageToken: 'page-2' } }));
    const first = await loadRecommendations({ category: cat('waterfalls'), location: MUNNAR, radiusKm: 50, sort: 'relevance' }, { provider });
    expect(first.nextPageToken).toBe('page-2');
    const second = await loadRecommendations({ category: cat('waterfalls'), location: MUNNAR, radiusKm: 50, sort: 'relevance', pageToken: first.nextPageToken }, { provider });
    expect(calls[1]?.body.pageToken).toBe('page-2');
    expect(second.places.map((p) => p.name)).toEqual(['Lakkam Waterfalls']);
    expect(second.nextPageToken).toBeNull();
  });

  it('keeps results for the session and does not ask again for the same centre, category, radius and order', async () => {
    let now = Date.parse('2026-11-16T10:00:00Z');
    const { provider, calls } = proxy(() => ({ json: { places: PLACES } }));
    const req = { category: cat('waterfalls'), location: MUNNAR, radiusKm: 10 as const, sort: 'relevance' as const };
    await loadRecommendations(req, { provider, now: () => new Date(now) });
    const again = await loadRecommendations({ ...req, location: { latitude: 10.08893, longitude: 77.05948 } }, { provider, now: () => new Date(now) });
    expect(calls).toHaveLength(1);
    expect(again.from).toBe('cache');
    await loadRecommendations({ ...req, radiusKm: 25 }, { provider, now: () => new Date(now) });
    expect(calls).toHaveLength(2);
    now += SESSION_CACHE_MS + 1;
    await loadRecommendations(req, { provider, now: () => new Date(now) });
    expect(calls).toHaveLength(3);
  });

  it('offline: shows what this session already loaded, marked as older; Google results are never written to the device', async () => {
    let now = Date.parse('2026-11-16T10:00:00Z');
    let online = true;
    const { provider } = proxy(() => (online ? { json: { places: PLACES } } : Promise.reject(new TypeError('Network request failed'))));
    const repos = await setupRepositories();
    const cache = createRemoteCacheRepository(repos.database);
    const req = { category: cat('waterfalls'), location: MUNNAR, radiusKm: 10 as const, sort: 'relevance' as const };
    await loadRecommendations(req, { provider, cache, now: () => new Date(now) });
    now += SESSION_CACHE_MS + 1;
    online = false;
    const stale = await loadRecommendations(req, { provider, cache, now: () => new Date(now) });
    expect(stale.from).toBe('stale_cache');
    expect(stale.places).toHaveLength(3);
    const stored = await repos.database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM remote_cache', []);
    expect(stored[0]?.n).toBe(0);
  });

  it('open map data (fallback) is stored on the device and reused offline', async () => {
    let online = true;
    const osmLike: PlacesProvider = {
      id: 'manual',
      configured: true,
      source: { kind: 'live', name: 'OpenStreetMap', attribution: '© OpenStreetMap contributors', storable: true },
      discover: async () => {
        if (!online) throw new PlacesError('offline');
        return [place('osm:n1', 'Attukad Waterfalls', { latitude: 10.0534, longitude: 77.0588 })];
      },
      autocomplete: async () => [],
      details: async () => {
        throw new PlacesError('not_found');
      },
      nearby: async () => [],
      textSearch: async () => [],
      photoUrl: () => null,
    };
    const repos = await setupRepositories();
    const cache = createRemoteCacheRepository(repos.database);
    const req = { category: cat('waterfalls'), location: MUNNAR, radiusKm: 10 as const, sort: 'relevance' as const };
    await loadRecommendations(req, { provider: osmLike, cache, now: () => new Date('2026-11-16T10:00:00Z') });
    clearRecommendationCache(); // e.g. the app was restarted
    online = false;
    const offline = await loadRecommendations(req, { provider: osmLike, cache, now: () => new Date('2026-11-30T10:00:00Z') });
    expect(offline.from).toBe('stale_cache');
    expect(offline.places[0]?.name).toBe('Attukad Waterfalls');
  });

  it('retry after a temporary failure loads normally', async () => {
    let fail = true;
    const { provider } = proxy(() => (fail ? { status: 429, json: { error: 'quota' } } : { json: { places: PLACES } }));
    const req = { category: cat('attractions'), location: MUNNAR, radiusKm: 10 as const, sort: 'relevance' as const };
    await expect(loadRecommendations(req, { provider })).rejects.toMatchObject({ kind: 'quota' });
    fail = false;
    expect((await loadRecommendations(req, { provider })).places).toHaveLength(3);
  });

  it('tells empty results apart from quota and network failures', async () => {
    const empty = proxy(() => ({ json: { places: [] } }));
    const page = await loadRecommendations({ category: cat('nature'), location: MUNNAR, radiusKm: 5, sort: 'relevance' }, { provider: empty.provider });
    expect(page.places).toEqual([]);

    clearRecommendationCache();
    const quota = proxy(() => ({ status: 429, json: { error: 'quota' } }));
    await expect(loadRecommendations({ category: cat('nature'), location: MUNNAR, radiusKm: 5, sort: 'relevance' }, { provider: quota.provider })).rejects.toMatchObject({ kind: 'quota' });
    clearRecommendationCache();
    const down = proxy(() => Promise.reject(new TypeError('Network request failed')));
    await expect(loadRecommendations({ category: cat('nature'), location: MUNNAR, radiusKm: 5, sort: 'relevance' }, { provider: down.provider })).rejects.toMatchObject({ kind: 'network' });

    expect(describeRecommendationError('quota')).toMatchObject({ title: expect.stringMatching(/busy/), retry: true });
    expect(describeRecommendationError('network')).toMatchObject({ retry: true });
    expect(describeRecommendationError('offline').title).toMatch(/offline/);
    expect(describeRecommendationError('denied').retry).toBe(false);
    expect(describeRecommendationError('unknown').message).not.toBe('');
  });

  it('without a configured provider: an honest error, never sample places', async () => {
    const unset: PlacesProvider = { id: 'google', configured: false, autocomplete: async () => [], details: async () => place('x', 'x', null), nearby: async () => [], textSearch: async () => [], photoUrl: () => null };
    await expect(loadRecommendations({ category: cat('attractions'), location: MUNNAR, radiusKm: 5, sort: 'relevance' }, { provider: unset })).rejects.toMatchObject({ kind: 'not_configured' });
  });
});
