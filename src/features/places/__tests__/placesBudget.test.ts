import { COOLDOWN_MS, GOOGLE_ENDPOINTS, withFallback } from '../config';
import { PlacesError, type PlaceDetails, type PlacesProvider } from '../provider';
import { createProxyProvider } from '../proxyProvider';
import { resolveShare } from '../sharedLocation';

const place = (id: string, name: string): PlaceDetails => ({ provider: 'manual', providerPlaceId: id, name, location: { latitude: 10.09, longitude: 77.06 }, formattedAddress: '', types: [], district: null, state: null, country: null, metadata: {}, rating: null, userRatingCount: null, editorialSummary: null, photos: [], mapsUri: null, attributions: [] });

/** Free open-data provider stand-in, counting calls. */
function freeProvider() {
  const calls = { autocomplete: 0, nearby: 0, textSearch: 0, discover: 0, details: 0 };
  const p: PlacesProvider = {
    id: 'manual',
    configured: true,
    source: { kind: 'live', name: 'OpenStreetMap', attribution: '© OpenStreetMap contributors', storable: true },
    autocomplete: async () => (calls.autocomplete++, [{ providerPlaceId: 'osm:n1', primaryText: 'Munnar (free)', secondaryText: 'Kerala', types: [], distanceMeters: null }]),
    details: async (id) => (calls.details++, place(id, 'Munnar (free)')),
    nearby: async () => (calls.nearby++, [place('osm:n2', 'Waterfall (free)')]),
    textSearch: async () => (calls.textSearch++, [place('osm:n3', 'Attukad (free)')]),
    discover: async () => (calls.discover++, [place('osm:n4', 'Viewpoint (free)')]),
    photoUrl: () => null,
  };
  return { provider: p, calls };
}

/** The places proxy as the app sees it, answering every request with `answer`. */
function proxy(answer: (path: string, body: Record<string, unknown>) => { status: number; json: unknown }) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    seen.push({ path, body });
    const r = answer(path, body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
  return { provider: createProxyProvider('https://proxy.example', fetchImpl), seen };
}

const EXHAUSTED = { status: 503, json: { error: 'budget_exhausted', code: 'GOOGLE_BUDGET_EXHAUSTED' } };

describe('Google budget on the app side', () => {
  it('budget exhausted: falls back to free search, says why, and does not retry Google', async () => {
    let t = 1_000_000;
    const google = proxy(() => EXHAUSTED);
    const free = freeProvider();
    const p = withFallback(google.provider, free.provider, () => t);
    expect((await p.autocomplete({ input: 'Munn', sessionToken: 'token-123456' }))[0]?.primaryText).toBe('Munnar (free)');
    expect(p.diagnostics()).toEqual({ active: 'free', reason: expect.objectContaining({ kind: 'budget_exhausted', code: 'GOOGLE_BUDGET_EXHAUSTED' }) });
    for (let i = 0; i < 5; i++) await p.autocomplete({ input: `Munnar ${i}`, sessionToken: 'token-123456' });
    expect(google.seen).toHaveLength(1);
    expect(free.calls.autocomplete).toBe(6);
    // After the cool-down Google is asked again, once.
    t += (COOLDOWN_MS.budget_exhausted ?? 0) + 1;
    await p.autocomplete({ input: 'Munnar', sessionToken: 'token-123456' });
    expect(google.seen).toHaveLength(2);
  });

  it('switched off, not set up, daily limit or proxy down: free search, never a generic failure', async () => {
    for (const answer of [
      { status: 503, json: { error: 'disabled', code: 'GOOGLE_DISABLED' } },
      { status: 503, json: { error: 'disabled', code: 'GOOGLE_BUDGET_UNAVAILABLE' } },
      { status: 503, json: { error: 'budget_exhausted', code: 'GOOGLE_DAILY_LIMIT' } },
      { status: 503, json: { error: 'not_configured', code: 'GOOGLE_NOT_CONFIGURED' } },
      { status: 502, json: {} },
    ]) {
      const free = freeProvider();
      const p = withFallback(proxy(() => answer).provider, free.provider);
      expect((await p.autocomplete({ input: 'Munn', sessionToken: 'token-123456' }))[0]?.primaryText).toBe('Munnar (free)');
      expect(p.diagnostics().active).toBe('free');
    }
    const down = withFallback(
      createProxyProvider('https://proxy.example', (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch),
      freeProvider().provider,
    );
    expect((await down.autocomplete({ input: 'Munn', sessionToken: 'token-123456' }))[0]?.primaryText).toBe('Munnar (free)');
    expect(down.diagnostics().reason?.kind).toBe('network');
  });

  it('the error keeps the service code for diagnostics', async () => {
    await expect(proxy(() => EXHAUSTED).provider.autocomplete({ input: 'Munn', sessionToken: 'token-123456' })).rejects.toEqual(
      expect.objectContaining({ kind: 'budget_exhausted', code: 'GOOGLE_BUDGET_EXHAUSTED' }),
    );
    expect(new PlacesError('budget_exhausted').message).toMatch(/free map search/);
  });

  it('Nearby, Text Search and Photos never go to Google (free data instead)', async () => {
    expect(GOOGLE_ENDPOINTS).toEqual({ autocomplete: true, details: true, nearby: false, textSearch: false, photos: false });
    const google = proxy(() => ({ status: 200, json: { places: [] } }));
    const free = freeProvider();
    const p = withFallback(google.provider, free.provider);
    await p.nearby({ location: { latitude: 10, longitude: 77 }, radiusMeters: 5000 });
    await p.textSearch({ query: 'Attukad' });
    await p.discover!({ selectors: [], category: 'waterfalls', location: { latitude: 10, longitude: 77 }, radiusMeters: 5000 });
    expect(p.photoUrl({ name: 'places/x/photos/y', widthPx: 1, heightPx: 1, authorAttributions: [] }, 400)).toBeNull();
    expect(google.seen).toHaveLength(0);
    expect([free.calls.nearby, free.calls.textSearch, free.calls.discover]).toEqual([1, 1, 1]);
    expect(p.source?.storable).toBe(true);
  });

  it('details for a pick send the tapped name and are reused, not fetched twice', async () => {
    const google = proxy(() => ({ status: 200, json: { place: { providerPlaceId: 'ChIJa', name: 'Attukad Waterfalls', location: { latitude: 10.05, longitude: 77.06 } } } }));
    const p = withFallback(google.provider, freeProvider().provider);
    await Promise.all([p.details('ChIJa', { sessionToken: 'token-123456', nameHint: 'Attukad Waterfalls' }), p.details('ChIJa', { sessionToken: 'token-123456', nameHint: 'Attukad Waterfalls' })]);
    await p.details('ChIJa', { nameHint: 'Attukad Waterfalls' });
    expect(google.seen).toHaveLength(1);
    expect(google.seen[0]?.body).toEqual({ placeId: 'ChIJa', sessionToken: 'token-123456', nameHint: 'Attukad Waterfalls' });
  });

  it('Google Maps sharing still works with Google over budget (free search, exact pins kept)', async () => {
    const free = freeProvider();
    const p = withFallback(proxy(() => EXHAUSTED).provider, free.provider);
    const offline = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const r = await resolveShare('Attukad Waterfalls, Attukad Waterfall Rd, Pallivasal, Keralam 685612', { provider: p, fetchImpl: offline });
    expect(r.status).toBe('choose');
    expect(free.calls.textSearch).toBeGreaterThan(0);
    const pinned = await resolveShare('10.0889, 77.0595', { provider: p, fetchImpl: offline });
    expect(pinned).toMatchObject({ status: 'located', place: { location: { latitude: 10.0889, longitude: 77.0595 } } });
  });
});
