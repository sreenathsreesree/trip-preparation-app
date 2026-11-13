import { fakeSyncServer } from '../../../../test/fakeSyncServer';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { linkAccount, runSync } from '../../sync/syncEngine';
import { toPlaceInput } from '../placeInput';
import { choosePlacesProvider } from '../config';
import { demoProvider } from '../demoProvider';
import { DISCOVERY_CATEGORIES, DISTANCE_FILTERS_KM, planMatcher, rankRecommendations } from '../discovery';
import { overpassQuery, placesFromOverpass, placesFromPhoton } from '../osm';
import { createOsmProvider, OVERPASS_URL, PHOTON_URL } from '../osmProvider';


const MUNNAR = { latitude: 10.0889, longitude: 77.0595 };
const overpassBody = {
  elements: [
    { type: 'node', id: 1, lat: 10.1, lon: 77.06, tags: { name: 'Attukad Waterfalls', natural: 'waterfall' } },
    { type: 'way', id: 2, center: { lat: 10.12, lon: 77.1 }, tags: { name: 'Lakkam Waterfalls', waterway: 'waterfall', wikipedia: 'en:Lakkam Waterfalls', wikidata: 'Q1' } },
    { type: 'node', id: 3, lat: 10.5, lon: 77.06, tags: { name: 'Far Falls', natural: 'waterfall' } },
    { type: 'node', id: 4, lat: 10.1, lon: 77.06, tags: { natural: 'waterfall' } }, // no name: dropped
    { type: 'node', id: 1, lat: 10.1, lon: 77.06, tags: { name: 'Attukad Waterfalls', natural: 'waterfall' } }, // duplicate
  ],
};

describe('OpenStreetMap places (free, keyless, no billing)', () => {
  it('builds an Overpass query for a category around the destination', () => {
    const q = overpassQuery(DISCOVERY_CATEGORIES.find((c) => c.key === 'waterfalls')!.osm, MUNNAR, 10_000);
    expect(q).toContain('nwr["natural"="waterfall"]["name"](around:10000,10.08890,77.05950);');
    expect(q).toContain('nwr["waterway"="waterfall"]["name"]');
    expect(q).toMatch(/out center tags \d+;$/);
    for (const c of DISCOVERY_CATEGORIES) expect(c.osm.length).toBeGreaterThan(0);
  });

  it('normalises results: named places only, once each, documented places first, attributed, storable', () => {
    const places = placesFromOverpass(overpassBody);
    expect(places.map((p) => p.name)).toEqual(['Lakkam Waterfalls', 'Attukad Waterfalls', 'Far Falls']);
    expect(places[0]).toMatchObject({ provider: 'manual', providerPlaceId: 'osm:w2', location: { latitude: 10.12, longitude: 77.1 }, attributions: ['© OpenStreetMap contributors'], rating: null });
    expect(places[0]!.metadata).toMatchObject({ source: 'osm', wikipedia: 'en:Lakkam Waterfalls' });
  });

  it('filters by distance (5/10/25/50 km) and marks places already in the plan, also when typed in by hand', () => {
    expect([...DISTANCE_FILTERS_KM]).toEqual([5, 10, 25, 50]);
    const places = placesFromOverpass(overpassBody);
    const inPlan = planMatcher([{ name: 'attukad  waterfalls', place: null }]);
    const recs = rankRecommendations(places, MUNNAR, 10, inPlan);
    expect(recs.map((r) => [r.place.name, r.inPlan])).toEqual([
      ['Lakkam Waterfalls', false],
      ['Attukad Waterfalls', true],
    ]);
    expect(rankRecommendations(places, MUNNAR, 50, inPlan)).toHaveLength(3);
    expect(rankRecommendations(places, MUNNAR, 10, inPlan, 'distance')[0]!.place.name).toBe('Attukad Waterfalls');
  });

  it('a same-named place far away is not treated as a duplicate', () => {
    const match = planMatcher([{ name: 'Echo Point', place: { location: { latitude: -33.73, longitude: 150.31 } } as never }]);
    expect(match({ providerPlaceId: 'osm:n9', name: 'Echo Point', location: MUNNAR })).toBe(false);
    expect(match({ providerPlaceId: 'osm:n9', name: 'Echo Point', location: { latitude: -33.731, longitude: 150.311 } })).toBe(true);
  });

  it('reads Photon search results for place search and destination locations', () => {
    const places = placesFromPhoton({
      features: [{ geometry: { coordinates: [77.0595, 10.0889] }, properties: { name: 'Munnar', osm_id: 123, osm_type: 'R', osm_key: 'place', osm_value: 'town', state: 'Kerala', country: 'India' } }],
    });
    expect(places).toEqual([expect.objectContaining({ providerPlaceId: 'osm:r123', name: 'Munnar', location: MUNNAR, formattedAddress: 'Kerala, India' })]);
  });

  it('calls only Overpass/Photon, maps errors honestly, and serves details from what search returned', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      if (url.startsWith(OVERPASS_URL)) {
        expect(String(init?.body)).toContain(encodeURIComponent('["tourism"="viewpoint"]').slice(0, 10));
        return new Response(JSON.stringify(overpassBody), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [77.0595, 10.0889] }, properties: { name: 'Munnar', osm_id: 5, osm_type: 'N' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createOsmProvider(fetchImpl);
    expect(provider.source).toEqual({ kind: 'live', name: 'OpenStreetMap', attribution: '© OpenStreetMap contributors' });
    const found = await provider.discover!({ selectors: ['["tourism"="viewpoint"]'], category: 'viewpoints', location: MUNNAR, radiusMeters: 5000, maxResults: 20 });
    expect(found).toHaveLength(3);
    const suggestions = await provider.autocomplete({ input: 'Munn', sessionToken: 'x', bias: MUNNAR });
    expect(suggestions[0]).toMatchObject({ providerPlaceId: 'osm:n5', primaryText: 'Munnar' });
    expect((await provider.details('osm:n5', {})).name).toBe('Munnar');
    expect(calls).toEqual([`POST ${OVERPASS_URL}`, `GET ${PHOTON_URL}`]);

    const offline = createOsmProvider((async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch);
    await expect(offline.discover!({ selectors: ['["tourism"]'], category: 'x', location: MUNNAR, radiusMeters: 1000 })).rejects.toMatchObject({ kind: 'offline' });
    const busy = createOsmProvider((async () => new Response('', { status: 429 })) as unknown as typeof fetch);
    await expect(busy.textSearch({ query: 'x' })).rejects.toMatchObject({ kind: 'quota' });
  }, 15_000);
});

describe('provider choice: no billing, no keys, demo never shown as live', () => {
  it('uses OpenStreetMap by default; Google only with a proxy URL; demo and off only by flag', () => {
    expect(choosePlacesProvider({})).toBe('osm');
    expect(choosePlacesProvider({ proxyUrl: 'http://insecure' })).toBe('osm');
    expect(choosePlacesProvider({ proxyUrl: 'https://places.example.com' })).toBe('google-proxy');
    expect(choosePlacesProvider({ provider: 'demo', proxyUrl: 'https://places.example.com' })).toBe('demo');
    expect(choosePlacesProvider({ provider: 'off' })).toBe('off');
  });

  it('demo data is labelled demo and says it is not real', async () => {
    expect(demoProvider.source?.kind).toBe('demo');
    const places = await demoProvider.discover!({ selectors: [], category: 'waterfalls', location: MUNNAR, radiusMeters: 5000 });
    expect(places.every((p) => p.name.startsWith('Sample') && p.metadata?.source === 'demo')).toBe(true);
  });
});

describe('adding a recommendation to the trip', () => {
  it('adds it under the destination once; the cloud backup accepts it (manual place with coordinates)', async () => {
    const r = await setupRepositories();
    const trip = await r.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
    const munnar = (await r.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
    const place = placesFromOverpass(overpassBody)[0]!;
    const first = await r.planner.addNode(trip.id, { place: toPlaceInput(place), parentId: munnar.id });
    const again = await r.planner.addNode(trip.id, { place: toPlaceInput(place), parentId: munnar.id });
    expect([first.status, again.status]).toEqual(['added', 'duplicate']);
    const plan = await r.planner.load(trip.id);
    expect(plan.nodes.filter((n) => n.name === 'Lakkam Waterfalls')).toHaveLength(1);
    expect(plan.nodes.find((n) => n.name === 'Lakkam Waterfalls')?.place).toMatchObject({ provider: 'manual', providerPlaceId: 'osm:w2', location: { latitude: 10.12, longitude: 77.1 } });
    const server = fakeSyncServer();
    await linkAccount(r.database, 'acct');
    const result = await runSync(r.database, server.apiFor('acct'), { accountId: 'acct', createId: r.deps.createId, now: r.deps.now });
    expect(result.rejected ?? []).toEqual([]);
    expect(server.count('acct', 'places')).toBeGreaterThanOrEqual(1);
  });
});
