import { followShortLink, findSamePlace, parseCoordinates, parseMapsUrl, parseShare, resolveShare } from '../sharedLocation';
import { normaliseQuery, queryVariants, searchPlaces, clearPlaceSearchCache } from '../placeSearch';
import { photonAddress } from '../osm';
import type { PlaceDetails } from '../provider';

const place = (name: string, lat = 10, lng = 77): PlaceDetails =>
  ({ provider: 'manual', providerPlaceId: `osm:n${name}`, name, location: { latitude: lat, longitude: lng }, formattedAddress: '', types: [], rating: null, userRatingCount: null, editorialSummary: null, photos: [], mapsUri: null, attributions: [] }) as PlaceDetails;

const jsonResponse = (body: unknown, url = '') => ({ ok: true, url, json: async () => body, text: async () => '' }) as unknown as Response;

describe('coordinates', () => {
  it.each([
    ['10.0889, 77.0595', 10.0889, 77.0595],
    ['10.0889 77.0595', 10.0889, 77.0595],
    ['(10.0889,77.0595)', 10.0889, 77.0595],
    ['10.0889° N, 77.0595° E', 10.0889, 77.0595],
    ['33.8688° S 151.2093° E', -33.8688, 151.2093],
    [`10°05'20"N 77°03'34"E`, 10.08889, 77.05944],
  ])('reads %s', (text, lat, lng) => {
    const p = parseCoordinates(text);
    expect(p?.latitude).toBeCloseTo(lat, 4);
    expect(p?.longitude).toBeCloseTo(lng, 4);
  });
  it('rejects out-of-range values', () => {
    expect(parseCoordinates('95, 200')).toBeNull();
    expect(parseCoordinates('Munnar')).toBeNull();
  });
});

describe('Google Maps and other map links', () => {
  it('prefers the pinned place over the map view and reads the name', () => {
    const r = parseMapsUrl('https://www.google.com/maps/place/Mattupetty+Dam/@10.10,77.10,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d10.1063!4d77.1236');
    expect(r.name).toBe('Mattupetty Dam');
    expect(r.location).toEqual({ latitude: 10.1063, longitude: 77.1236 });
  });
  it.each([
    ['https://maps.google.com/?q=10.0889,77.0595', 10.0889],
    ['https://www.google.com/maps/search/?api=1&query=10.0889%2C77.0595', 10.0889],
    ['https://www.google.com/maps/search/10.0889,+77.0595?entry=tts', 10.0889],
    ['https://www.google.com/maps/dir/?api=1&destination=10.0889,77.0595', 10.0889],
    ['geo:10.0889,77.0595?q=10.0889,77.0595(Munnar)', 10.0889],
    ['https://www.openstreetmap.org/?mlat=10.0889&mlon=77.0595#map=15/10.0889/77.0595', 10.0889],
  ])('reads coordinates from %s', (url, lat) => {
    expect(parseMapsUrl(url).location?.latitude).toBeCloseTo(lat, 4);
  });
  it('keeps a search name when there are no coordinates', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=Eravikulam+National+Park')).toEqual({ location: null, name: 'Eravikulam National Park' });
    expect(parseMapsUrl('geo:0,0?q=Top+Station').name).toBe('Top Station');
  });
});

describe('shared text', () => {
  it('reads what the Google Maps app shares (name, address, short link)', () => {
    const p = parseShare('Kolukkumalai Tea Estate\nSuryanelli, Kerala 685618\nhttps://maps.app.goo.gl/AbCdEf123');
    expect(p.shortLink).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(p.name).toBe('Kolukkumalai Tea Estate');
    expect(p.query).toContain('Kolukkumalai Tea Estate');
  });

  it('follows short links and uses the coordinates they lead to', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith('https://maps.app.goo.gl')) return jsonResponse({}, 'https://www.google.com/maps/place/Top+Station/@10.12,77.24,14z/data=!3d10.1234!4d77.2468');
      return jsonResponse({ features: [{ geometry: { coordinates: [77.2468, 10.1234] }, properties: { name: 'Top Station', osm_id: 5, osm_type: 'N', state: 'Kerala' } }] });
    }) as unknown as typeof fetch;
    const r = await resolveShare('https://maps.app.goo.gl/xyz', { fetchImpl, provider: { configured: true, textSearch: jest.fn() } });
    expect(r.status).toBe('located');
    if (r.status === 'located') {
      expect(r.place.name).toBe('Top Station');
      expect(r.place.location).toEqual({ latitude: 10.1234, longitude: 77.2468 });
      expect(r.place.state).toBe('Kerala');
    }
  });

  it('searches by name and lets the user choose when there are no coordinates', async () => {
    const textSearch = jest.fn(async () => [place('Munnar'), place('Munnar Bus Stand')]);
    const r = await resolveShare('Munnar', { fetchImpl: jest.fn() as unknown as typeof fetch, provider: { configured: true, textSearch } });
    expect(r).toMatchObject({ status: 'choose', query: 'Munnar' });
  });

  it('reports a short link that cannot be opened instead of guessing', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await followShortLink('https://maps.app.goo.gl/x', fetchImpl)).toBeNull();
    const r = await resolveShare('https://maps.app.goo.gl/x', { fetchImpl, provider: { configured: true, textSearch: jest.fn() } });
    expect(r).toMatchObject({ status: 'unresolved' });
  });

  it('finds the same place already in a plan by id, distance or name', () => {
    const nodes = [{ id: 'a', name: 'Munnar', place: { providerPlaceId: 'osm:n1', location: { latitude: 10.0889, longitude: 77.0595 } } }];
    expect(findSamePlace(nodes, { providerPlaceId: null, name: 'Pin', location: { latitude: 10.0895, longitude: 77.0597 } })?.id).toBe('a');
    expect(findSamePlace(nodes, { providerPlaceId: 'osm:n1', name: 'X', location: null })?.id).toBe('a');
    expect(findSamePlace(nodes, { providerPlaceId: null, name: 'Thekkady', location: { latitude: 9.6, longitude: 77.16 } })).toBeNull();
  });
});

describe('autocomplete search', () => {
  beforeEach(clearPlaceSearchCache);
  it('normalises accents and punctuation and tries simpler variants', () => {
    expect(normaliseQuery('  Pondichéry!! ')).toBe('Pondichery');
    expect(queryVariants('the Elephant beach near Havelock')).toEqual(['the Elephant beach near Havelock', 'Elephant beach Havelock', 'Elephant beach', 'Elephant']);
  });
  it('falls back to a simpler query and caches results', async () => {
    const textSearch = jest.fn(async ({ query }: { query: string }) => (query === 'Kochi' ? [place('Kochi')] : []));
    const provider = { textSearch } as never;
    const first = await searchPlaces('Kochi fort area', { provider });
    expect(first.usedQuery).toBe('Kochi');
    await searchPlaces('Kochi fort area', { provider });
    expect(textSearch.mock.calls.length).toBe(3);
  });
  it('labels results with kind, locality, district and state', () => {
    expect(photonAddress({ osm_value: 'hotel', city: 'Munnar', county: 'Idukki', state: 'Kerala', country: 'India' }, 'Tea County')).toBe('Hotel · Munnar, Idukki, Kerala, India');
  });
});
