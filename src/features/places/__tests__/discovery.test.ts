import type { PlanNode } from '../../planner/model';
import { contextLocation, formatDistance, rankRecommendations, typeLabel } from '../discovery';
import { createProxyProvider, sanitizePlace } from '../proxyProvider';
import { isPlacesError, unconfiguredProvider, type PlaceDetails } from '../provider';

const munnar = { latitude: 10.0889, longitude: 77.0595 };
const details = (id: string, overrides: Partial<PlaceDetails> = {}): PlaceDetails => ({
  provider: 'google',
  providerPlaceId: id,
  name: id,
  location: munnar,
  formattedAddress: '',
  types: [],
  district: null,
  state: null,
  country: null,
  metadata: {},
  rating: null,
  userRatingCount: null,
  editorialSummary: null,
  photos: [],
  mapsUri: null,
  attributions: [],
  ...overrides,
});

describe('ranking recommendations', () => {
  const places = [
    details('near', { location: { latitude: 10.1, longitude: 77.06 }, rating: 4.1, userRatingCount: 900 }),
    details('far', { location: { latitude: 10.4, longitude: 77.06 }, rating: 4.9, userRatingCount: 50 }),
    details('mid', { location: { latitude: 10.15, longitude: 77.06 }, rating: 4.8, userRatingCount: 5 }),
    details('near'), // duplicate
    details('nolocation', { location: null }),
  ];

  it('dedupes, drops places beyond the distance filter, marks places already in the plan', () => {
    const recs = rankRecommendations(places, munnar, 10, new Set(['mid']));
    expect(recs.map((r) => r.place.providerPlaceId)).toEqual(['near', 'mid', 'nolocation']);
    expect(recs.find((r) => r.place.providerPlaceId === 'mid')?.inPlan).toBe(true);
    expect(recs.find((r) => r.place.providerPlaceId === 'nolocation')?.distanceMeters).toBeNull();
    expect(rankRecommendations(places, munnar, 50, new Set()).map((r) => r.place.providerPlaceId)).toContain('far');
  });

  it('sorts by distance or by rating weighted by review count', () => {
    expect(rankRecommendations(places, munnar, 50, new Set(), 'distance').map((r) => r.place.providerPlaceId)).toEqual(['near', 'mid', 'far', 'nolocation']);
    expect(rankRecommendations(places, munnar, 50, new Set(), 'rating')[0]?.place.providerPlaceId).toBe('near');
  });

  it('labels types and formats distances', () => {
    expect(typeLabel(['point_of_interest', 'national_park'])).toBe('National park');
    expect(typeLabel(['point_of_interest'])).toBeNull();
    expect(formatDistance(347)).toBe('350 m');
    expect(formatDistance(4321)).toBe('4.3 km');
    expect(formatDistance(23456)).toBe('23 km');
  });
});

describe('recommendation context', () => {
  const node = (id: string, parentId: string | null, location: typeof munnar | null): PlanNode =>
    ({
      id,
      parentId,
      position: 0,
      createdAt: '',
      name: id,
      place: location
        ? { id: `p-${id}`, provider: 'google', providerPlaceId: id, name: id, location, formattedAddress: '', types: [], district: null, state: null, country: null, metadata: {}, fetchedAt: null, createdAt: '', updatedAt: '' }
        : null,
    }) as unknown as PlanNode;
  it('uses the nearest place above with a verified location', () => {
    const nodes = [node('munnar', null, munnar), node('area', 'munnar', null), node('spot', 'area', null), node('kochi', null, null)];
    expect(contextLocation(nodes, 'spot')?.from.id).toBe('munnar');
    expect(contextLocation(nodes, 'kochi')).toBeNull();
    expect(contextLocation(nodes, null)).toBeNull();
  });
});

describe('places proxy client', () => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  const fail = (status: number, body: unknown = {}) => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);

  it('posts to the proxy and keeps only well-formed places', async () => {
    const fetchMock = jest.fn(() => ok({ places: [details('a', { rating: 4.5 }), { name: 'missing id' }, null] }));
    const provider = createProxyProvider('https://proxy.example.com/', fetchMock as unknown as typeof fetch);
    const result = await provider.nearby({ location: munnar, radiusMeters: 5000, includedTypes: ['park'] });
    expect(result.map((p) => [p.providerPlaceId, p.rating])).toEqual([['a', 4.5]]);
    expect(fetchMock).toHaveBeenCalledWith('https://proxy.example.com/nearby', expect.objectContaining({ method: 'POST' }));
    expect(provider.photoUrl({ name: 'places/a/photos/1', widthPx: 1, heightPx: 1, authorAttributions: [] }, 400)).toBe(
      'https://proxy.example.com/photo?name=places%2Fa%2Fphotos%2F1&maxWidthPx=400',
    );
  });

  it('maps failures to clear errors', async () => {
    const cases: [Promise<Response> | (() => Promise<Response>), string][] = [
      [fail(429), 'quota'],
      [fail(403), 'denied'],
      [fail(200, { error: 'not_configured' }), 'not_configured'],
      [Promise.reject(new TypeError('Network request failed')), 'network'],
    ];
    for (const [response, kind] of cases) {
      const provider = createProxyProvider('https://p.example.com', (() => response) as unknown as typeof fetch);
      const error = await provider.textSearch({ query: 'waterfall' }).catch((e: unknown) => e);
      expect(isPlacesError(error) && error.kind).toBe(kind);
    }
  });

  it('is never configured without a proxy, and never returns sample data', async () => {
    expect(unconfiguredProvider.configured).toBe(false);
    await expect(unconfiguredProvider.nearby({ location: munnar, radiusMeters: 1000 })).rejects.toMatchObject({ kind: 'not_configured' });
    expect(unconfiguredProvider.photoUrl({ name: 'x', widthPx: 1, heightPx: 1, authorAttributions: [] }, 100)).toBeNull();
    expect(sanitizePlace({ providerPlaceId: 'x', name: '  ' })).toBeNull();
  });
});
