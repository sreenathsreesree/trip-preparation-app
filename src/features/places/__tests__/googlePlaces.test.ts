import { withFallback } from '../config';
import { findSamePlace } from '../sharedLocation';
import { planMatcher } from '../discovery';
import { clearSuggestionCache, createSessionToken, describeSearchError, resolveSuggestion, searchSuggestions } from '../placeSearch';
import { PlacesError, type PlaceDetails, type PlacesProvider } from '../provider';
import { createProxyProvider } from '../proxyProvider';

type Call = { url: string; body: Record<string, unknown> | null };

/** A fake Trip Prep places proxy (what server/places-proxy returns), recording calls. */
function fakeProxy(routes: Record<string, (body: Record<string, unknown>) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const r = route(body ?? {});
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { provider: createProxyProvider('https://proxy.example', fetchImpl), calls };
}

const ATTUKAD = {
  providerPlaceId: 'ChIJattukad',
  name: 'Attukad Waterfalls',
  formattedAddress: 'Attukad Waterfall Rd, Pallivasal, Kerala 685612, India',
  location: { latitude: 10.0534, longitude: 77.0588 },
  types: ['tourist_attraction'],
  district: 'Idukki',
  state: 'Kerala',
  country: 'India',
  metadata: { locality: 'Pallivasal', plusCode: '7J2V3335+9GH' },
  rating: 4.3,
  userRatingCount: 5120,
};

beforeEach(clearSuggestionCache);

describe('Google Places autocomplete (through the proxy)', () => {
  it('suggests places for partial names with their locality, district and state', async () => {
    const { provider, calls } = fakeProxy({
      '/autocomplete': (b) => ({
        json: {
          suggestions:
            String(b.input).toLowerCase().startsWith('attu')
              ? [
                  { providerPlaceId: 'ChIJattukad', primaryText: 'Attukad Waterfalls', secondaryText: 'Pallivasal, Idukki, Kerala', types: ['tourist_attraction'], distanceMeters: 4200 },
                  { providerPlaceId: 'ChIJbad', primaryText: '', secondaryText: 'dropped: no name' },
                ]
              : [],
        },
      }),
    });
    const token = createSessionToken();
    const { suggestions } = await searchSuggestions('Attuk', { provider, sessionToken: token });
    expect(suggestions).toEqual([{ providerPlaceId: 'ChIJattukad', primaryText: 'Attukad Waterfalls', secondaryText: 'Pallivasal, Idukki, Kerala', types: ['tourist_attraction'], distanceMeters: 4200 }]);
    expect(calls[0]?.body).toMatchObject({ input: 'Attuk', sessionToken: token });
  });

  it('tries simpler spellings only when the exact text finds nothing', async () => {
    const { provider, calls } = fakeProxy({
      '/autocomplete': (b) => ({ json: { suggestions: b.input === 'Mattupetty Dam' ? [{ providerPlaceId: 'ChIJdam', primaryText: 'Mattupetty Dam', secondaryText: 'Munnar, Kerala' }] : [] } }),
    });
    const r = await searchSuggestions('the Mattupetty Dam near', { provider, sessionToken: 't' });
    expect(r.usedQuery).toBe('Mattupetty Dam');
    expect(r.suggestions[0]?.primaryText).toBe('Mattupetty Dam');
    expect(calls.length).toBeGreaterThan(1);
  });

  it('fetches details only for the picked suggestion, in the same session, and fills every field', async () => {
    const { provider, calls } = fakeProxy({
      '/autocomplete': () => ({ json: { suggestions: [{ providerPlaceId: 'ChIJattukad', primaryText: 'Attukad Waterfalls', secondaryText: 'Pallivasal, Kerala' }, { providerPlaceId: 'ChIJother', primaryText: 'Other', secondaryText: '' }] } }),
      '/details': () => ({ json: { place: ATTUKAD } }),
    });
    const token = createSessionToken();
    const { suggestions } = await searchSuggestions('Attukad', { provider, sessionToken: token });
    expect(calls.filter((c) => c.url.endsWith('/details'))).toHaveLength(0);
    const place = await resolveSuggestion(suggestions[0]!, { provider, sessionToken: token });
    const details = calls.filter((c) => c.url.endsWith('/details'));
    expect(details).toHaveLength(1);
    expect(details[0]?.body).toEqual({ placeId: 'ChIJattukad', sessionToken: token });
    expect(place).toMatchObject({
      provider: 'google',
      providerPlaceId: 'ChIJattukad',
      name: 'Attukad Waterfalls',
      formattedAddress: 'Attukad Waterfall Rd, Pallivasal, Kerala 685612, India',
      location: { latitude: 10.0534, longitude: 77.0588 },
      district: 'Idukki',
      state: 'Kerala',
      country: 'India',
      metadata: { locality: 'Pallivasal', plusCode: '7J2V3335+9GH' },
    });
  });

  it('never fabricates coordinates when the service has none', async () => {
    const { provider } = fakeProxy({ '/details': () => ({ json: { place: { ...ATTUKAD, location: null } } }) });
    const place = await resolveSuggestion({ providerPlaceId: 'ChIJattukad', primaryText: 'Attukad Waterfalls', secondaryText: '', types: [], distanceMeters: null }, { provider, sessionToken: 't' });
    expect(place.location).toBeNull();
    const bad = fakeProxy({ '/details': () => ({ json: { place: { ...ATTUKAD, location: { latitude: 'x', longitude: 1 } } } }) });
    expect((await resolveSuggestion({ providerPlaceId: 'ChIJattukad', primaryText: 'A', secondaryText: '', types: [], distanceMeters: null }, { provider: bad.provider, sessionToken: 't' })).location).toBeNull();
  });

  it('reports offline, quota and refused errors clearly', async () => {
    const offline = createProxyProvider('https://proxy.example', (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch);
    await expect(searchSuggestions('Munnar', { provider: offline, sessionToken: 't' })).rejects.toMatchObject({ kind: 'network' });
    expect(describeSearchError(new PlacesError('network'))).toMatch(/offline|connection/i);

    const quota = fakeProxy({ '/autocomplete': () => ({ status: 429, json: { error: 'quota' } }) });
    await expect(searchSuggestions('Munnar', { provider: quota.provider, sessionToken: 't' })).rejects.toMatchObject({ kind: 'quota' });
    expect(describeSearchError(new PlacesError('quota'))).toMatch(/limit/);

    const unset = fakeProxy({ '/autocomplete': () => ({ status: 503, json: { error: 'not_configured' } }) });
    await expect(searchSuggestions('Munnar', { provider: unset.provider, sessionToken: 't' })).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('a failed details lookup leaves manual entry possible (the error is explained, nothing is invented)', async () => {
    const { provider } = fakeProxy({ '/details': () => ({ status: 404, json: { error: 'not_found' } }) });
    const failed = resolveSuggestion({ providerPlaceId: 'ChIJgone', primaryText: 'Gone place', secondaryText: '', types: [], distanceMeters: null }, { provider, sessionToken: 't' });
    await expect(failed).rejects.toMatchObject({ kind: 'not_found' });
    expect(describeSearchError(new PlacesError('not_found'))).toMatch(/couldn’t be loaded/);
  });

  it('session tokens are unique, UUID-shaped and at most 36 characters', () => {
    const tokens = new Set(Array.from({ length: 50 }, createSessionToken));
    expect(tokens.size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('duplicate handling keeps working with Google places', () => {
  const nodes = [
    { id: 'n1', name: 'Attukad Waterfalls', place: { providerPlaceId: 'ChIJattukad', location: { latitude: 10.0534, longitude: 77.0588 } } },
    { id: 'n2', name: 'Munnar', place: { providerPlaceId: null, location: null } },
  ];
  it('same Place ID, same spot, or same name without a location', () => {
    expect(findSamePlace(nodes, { providerPlaceId: 'ChIJattukad', name: 'Something else' })?.id).toBe('n1');
    expect(findSamePlace(nodes, { providerPlaceId: 'ChIJnew', name: 'Waterfall viewpoint', location: { latitude: 10.0536, longitude: 77.059 } })?.id).toBe('n1');
    expect(findSamePlace(nodes, { providerPlaceId: 'ChIJmunnar', name: 'munnar' })?.id).toBe('n2');
    expect(findSamePlace(nodes, { providerPlaceId: 'ChIJfar', name: 'Top Station', location: { latitude: 10.12, longitude: 77.24 } })).toBeNull();
    expect(planMatcher(nodes as unknown as Parameters<typeof planMatcher>[0])({ providerPlaceId: 'ChIJattukad', name: 'x', location: null })).toBe(true);
  });
});

describe('Google first, open data only when Google is not set up', () => {
  const place = (id: string, name: string): PlaceDetails => ({ provider: 'manual', providerPlaceId: id, name, location: null, formattedAddress: '', types: [], district: null, state: null, country: null, metadata: {}, rating: null, userRatingCount: null, editorialSummary: null, photos: [], mapsUri: null, attributions: [] });
  const fallback: PlacesProvider = {
    id: 'manual',
    configured: true,
    autocomplete: async () => [{ providerPlaceId: 'osm:n1', primaryText: 'Munnar (open data)', secondaryText: '', types: [], distanceMeters: null }],
    details: async (id) => place(id, 'Munnar (open data)'),
    nearby: async () => [],
    textSearch: async () => [place('osm:n1', 'Munnar (open data)')],
    photoUrl: () => null,
  };

  it('falls back only when the proxy reports not_configured', async () => {
    const unset = fakeProxy({ '/autocomplete': () => ({ status: 503, json: { error: 'not_configured' } }) });
    const p = withFallback(unset.provider, fallback);
    expect((await p.autocomplete({ input: 'Munnar', sessionToken: 't' }))[0]?.primaryText).toBe('Munnar (open data)');
    expect((await p.details('osm:n1', {})).name).toBe('Munnar (open data)');
  });

  it('does not hide quota or network errors behind other data', async () => {
    const busy = fakeProxy({ '/autocomplete': () => ({ status: 429, json: { error: 'quota' } }) });
    await expect(withFallback(busy.provider, fallback).autocomplete({ input: 'Munnar', sessionToken: 't' })).rejects.toMatchObject({ kind: 'quota' });
  });
});

describe('saved places are never degraded by a lookup', () => {
  it('re-saving a known Place ID without coordinates keeps the saved coordinates and address', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setupRepositories } = require('../../../../test/fixtures') as typeof import('../../../../test/fixtures');
    const repos = await setupRepositories();
    const first = await repos.planner.upsertPlace({ provider: 'google', providerPlaceId: 'ChIJattukad', name: 'Attukad Waterfalls', location: { latitude: 10.0534, longitude: 77.0588 }, formattedAddress: 'Pallivasal, Kerala', state: 'Kerala' });
    const again = await repos.planner.upsertPlace({ provider: 'google', providerPlaceId: 'ChIJattukad', name: 'Attukad Waterfalls', location: null, formattedAddress: '' });
    expect(again.id).toBe(first.id);
    expect(again.location).toEqual({ latitude: 10.0534, longitude: 77.0588 });
    expect(again.formattedAddress).toBe('Pallivasal, Kerala');
    expect(again.state).toBe('Kerala');
    const moved = await repos.planner.upsertPlace({ provider: 'google', providerPlaceId: 'ChIJattukad', name: 'Attukad Waterfalls', location: { latitude: 10.0535, longitude: 77.0589 } });
    expect(moved.location).toEqual({ latitude: 10.0535, longitude: 77.0589 });
  });
});
