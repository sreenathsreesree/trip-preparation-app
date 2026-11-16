import { distanceMeters } from '../../planner/arrival';
import { watchShares } from '../../shareIntake/ShareIntakeWatcher';
import { decode, encode, isFullCode, isShortCode, plusCodeLocation, recoverNearest } from '../plusCodes';
import type { PlaceDetails, PlacesProvider } from '../provider';
import { parseMapsUrl, parseShare, resolveShare, splitShareLine } from '../sharedLocation';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const ATTUKAD_LINE = '3335+9GH Attukad Waterfalls, Attukad Waterfall Rd, Pallivasal, Keralam 685612';
const SHORT = 'https://maps.app.goo.gl/8zeE1LFGqptD1vu9A';
const ATTUKAD_PIN = { latitude: 10.05344, longitude: 77.05881 };

const google = (id: string, name: string, location: { latitude: number; longitude: number } | null, extra: Partial<PlaceDetails> = {}): PlaceDetails => ({
  provider: 'google',
  providerPlaceId: id,
  name,
  location,
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
  ...extra,
});

/** A Google-like provider with spies; offline fetch by default (short links can't be opened on the device). */
function setup(over: Partial<PlacesProvider> = {}) {
  const provider = {
    id: 'google' as const,
    configured: true,
    textSearch: jest.fn(async () => [] as PlaceDetails[]),
    details: jest.fn(async (id: string) => google(id, 'From Place ID', { latitude: 10.1, longitude: 77.1 })),
    nearby: jest.fn(async () => [] as PlaceDetails[]),
    resolveLink: jest.fn(async () => null as string | null),
    ...over,
  };
  const offline = (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  return { provider, fetchImpl: offline };
}

describe('Plus Codes', () => {
  it('decodes full codes and recovers short ones near a reference point', () => {
    expect(isFullCode('8FVC9G8F+6X')).toBe(true);
    expect(isShortCode('3335+9GH')).toBe(true);
    expect(isFullCode('3335+9GH')).toBe(false);
    const known = decode('9C3W9QCJ+2VX');
    expect(known?.center.latitude).toBeCloseTo(51.3701125, 6);
    expect(known?.center.longitude).toBeCloseTo(-1.217765625, 6);
    expect(recoverNearest('9G8F+6X', { latitude: 47.4, longitude: 8.6 })).toBe('8FVC9G8F+6X');
    expect(encode({ latitude: 47.36556, longitude: 8.52494 }).slice(0, 8)).toBe('8FVC9G8F');
    const near = recoverNearest('3335+9GH', { latitude: 10.0889, longitude: 77.0595 });
    expect(near).toBe('7J2V3335+9GH');
    const pin = plusCodeLocation('3335+9GH', { latitude: 10.0889, longitude: 77.0595 });
    expect(distanceMeters(pin!, ATTUKAD_PIN)).toBeLessThan(15);
    expect(plusCodeLocation('3335+9GH')).toBeNull(); // a short code alone is not a location
  });
});

describe('reading what Google Maps shares', () => {
  it('splits a Plus Code + address line into a clean name, address and locality', () => {
    expect(splitShareLine(ATTUKAD_LINE)).toEqual({
      name: 'Attukad Waterfalls',
      address: 'Attukad Waterfalls, Attukad Waterfall Rd, Pallivasal, Keralam 685612',
      plusCode: '3335+9GH',
      locality: 'Pallivasal',
    });
    expect(splitShareLine('Munnar')).toEqual({ name: 'Munnar', address: null, plusCode: null, locality: null });
  });

  it('never searches the whole address or the Plus Code', () => {
    const parsed = parseShare(`${ATTUKAD_LINE}\n${SHORT}`);
    expect(parsed).toMatchObject({ name: 'Attukad Waterfalls', query: 'Attukad Waterfalls', plusCode: '3335+9GH', locality: 'Pallivasal', shortLink: SHORT, url: SHORT });
    const named = parseShare(`Attukad Waterfalls\n${ATTUKAD_LINE}\n${SHORT}`);
    expect(named.name).toBe('Attukad Waterfalls');
    expect(named.address).toContain('Pallivasal');
  });

  it('reads Place IDs, coordinates and names from regular Maps URLs', () => {
    expect(parseMapsUrl('https://www.google.com/maps/search/?api=1&query=Attukad&query_place_id=ChIJabcdefghijklmnop').placeId).toBe('ChIJabcdefghijklmnop');
    expect(parseMapsUrl('https://www.google.com/maps/place/Attukad+Waterfalls/@10.05,77.05,17z/data=!3d10.0534!4d77.0588')).toEqual({
      location: { latitude: 10.0534, longitude: 77.0588 },
      name: 'Attukad Waterfalls',
      placeId: null,
    });
    expect(parseMapsUrl('geo:10.0889,77.0595?q=10.0889,77.0595(Kolukkumalai)')).toMatchObject({ location: { latitude: 10.0889, longitude: 77.0595 }, name: 'Kolukkumalai' });
  });

  it('a full Plus Code is an exact location', () => {
    const parsed = parseShare('7J2V3335+9GH Attukad Waterfalls, Pallivasal, Kerala');
    expect(distanceMeters(parsed.location!, ATTUKAD_PIN)).toBeLessThan(15);
    expect(parsed.name).toBe('Attukad Waterfalls');
  });
});

describe('resolving a shared place', () => {
  it('maps.app.goo.gl: follows the link on the device and matches the place at the pin', async () => {
    const { provider } = setup({
      nearby: jest.fn(async () => [google('ChIJattukad', 'Attukad Waterfalls', { latitude: 10.0534, longitude: 77.0588 }), google('ChIJshop', 'Tea shop', { latitude: 10.0535, longitude: 77.0589 })]),
    });
    const fetchImpl = (async () => ({ url: 'https://www.google.com/maps/place/Attukad+Waterfalls/data=!3d10.0534!4d77.0588', text: async () => '' })) as unknown as typeof fetch;
    const r = await resolveShare(`Attukad Waterfalls\n${SHORT}`, { provider, fetchImpl });
    expect(r.status).toBe('located');
    if (r.status !== 'located') return;
    expect(r.place.providerPlaceId).toBe('ChIJattukad');
    expect(r.place.metadata?.sharedUrl).toBe(SHORT);
    expect(provider.nearby).toHaveBeenCalledWith(expect.objectContaining({ rank: 'distance', radiusMeters: 150 }), undefined);
  });

  it('uses the places service to open a short link the device could not open', async () => {
    const { provider, fetchImpl } = setup({ resolveLink: jest.fn(async () => 'https://www.google.com/maps/search/?api=1&query=Attukad&query_place_id=ChIJattukad1234567') });
    const r = await resolveShare(SHORT, { provider, fetchImpl });
    expect(provider.resolveLink).toHaveBeenCalledWith(SHORT, undefined);
    expect(provider.details).toHaveBeenCalledWith('ChIJattukad1234567', {}, undefined);
    expect(r).toMatchObject({ status: 'located', place: { providerPlaceId: 'ChIJattukad1234567', metadata: { sharedUrl: SHORT } } });
  });

  it('Plus Code + address: searches the clean name and turns the short code into the exact pin', async () => {
    const { provider, fetchImpl } = setup({
      textSearch: jest.fn(async () => [google('ChIJattukad', 'Attukad Waterfalls', { latitude: 10.0536, longitude: 77.0587 }, { formattedAddress: 'Pallivasal, Kerala' })]),
    });
    const r = await resolveShare(`${ATTUKAD_LINE}\n${SHORT}`, { provider, fetchImpl });
    expect(provider.textSearch).toHaveBeenCalledWith({ query: 'Attukad Waterfalls', maxResults: 6 }, undefined);
    expect(r).toMatchObject({ status: 'located', place: { providerPlaceId: 'ChIJattukad', metadata: { sharedUrl: SHORT } } });
  });

  it('a name match far from the Plus Code is offered with the exact pin first (never chosen silently)', async () => {
    const { provider, fetchImpl } = setup({
      textSearch: jest.fn(async () => [google('ChIJother', 'Attukad Waterfalls Resort', { latitude: 10.07, longitude: 77.08 })]),
    });
    const r = await resolveShare(`${ATTUKAD_LINE}\n${SHORT}`, { provider, fetchImpl });
    expect(r.status).toBe('choose');
    if (r.status !== 'choose') return;
    expect(r.candidates[0]?.providerPlaceId).toMatch(/^pin:/);
    expect(distanceMeters(r.candidates[0]!.location!, ATTUKAD_PIN)).toBeLessThan(15);
    expect(r.candidates[1]?.providerPlaceId).toBe('ChIJother');
  });

  it('a name only: searches it, then with the locality, and asks the user to choose', async () => {
    const textSearch = jest.fn(async ({ query }: { query: string }) => (query.includes('Pallivasal') ? [google('ChIJa', 'Attukad Waterfalls', { latitude: 10.05, longitude: 77.06 })] : []));
    const { provider, fetchImpl } = setup({ textSearch: textSearch as unknown as PlacesProvider['textSearch'] });
    const r = await resolveShare('Attukad Waterfalls, Attukad Waterfall Rd, Pallivasal, Keralam 685612', { provider, fetchImpl });
    expect(textSearch.mock.calls.map((c) => c[0].query)).toEqual(['Attukad Waterfalls', 'Attukad Waterfalls Pallivasal']);
    expect(r.status).toBe('choose');
  });

  it('coordinates only: keeps the exact pin when no place is right there', async () => {
    const { provider, fetchImpl } = setup({ nearby: jest.fn(async () => [google('ChIJfar', 'Somewhere', { latitude: 10.2, longitude: 77.2 })]) });
    const r = await resolveShare('10.0889, 77.0595', { provider, fetchImpl });
    expect(r).toMatchObject({ status: 'located', place: { location: { latitude: 10.0889, longitude: 77.0595 } } });
    if (r.status === 'located') expect(r.place.providerPlaceId).toMatch(/^pin:/);
  });

  it('geo: links still work', async () => {
    const { provider, fetchImpl } = setup();
    const r = await resolveShare('geo:10.0889,77.0595?q=10.0889,77.0595(Kolukkumalai)', { provider, fetchImpl });
    expect(r).toMatchObject({ status: 'located', place: { name: 'Kolukkumalai', location: { latitude: 10.0889, longitude: 77.0595 } } });
  });

  it('a short link that cannot be opened, with nothing else: a clear fallback, never a guess', async () => {
    const { provider, fetchImpl } = setup();
    const r = await resolveShare(SHORT, { provider, fetchImpl });
    expect(r).toMatchObject({ status: 'unresolved', url: SHORT });
    expect(provider.textSearch).not.toHaveBeenCalled();
  });

  it('failed lookup: explains, and keeps the name and link for adding by name', async () => {
    const { provider, fetchImpl } = setup({
      textSearch: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const r = await resolveShare(`${ATTUKAD_LINE}\n${SHORT}`, { provider, fetchImpl });
    expect(r).toMatchObject({ status: 'unresolved', name: 'Attukad Waterfalls', url: SHORT });
    if (r.status === 'unresolved') expect(r.reason).toMatch(/add it by name/);
  });

  it('a Place ID that fails to load falls back to the coordinates', async () => {
    const { provider, fetchImpl } = setup({
      details: jest.fn(async () => {
        throw new Error('gone');
      }),
    });
    const r = await resolveShare('https://www.google.com/maps/place/Top+Station/@10.12,77.24,15z/data=!3d10.1228!4d77.2433?query_place_id=ChIJtopstation12345', { provider, fetchImpl });
    expect(r).toMatchObject({ status: 'located', place: { name: 'Top Station', location: { latitude: 10.1228, longitude: 77.2433 } } });
  });
});

describe('Android share intents', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('cold start: routes the share that opened the app once, after the navigator mounts', () => {
    const route = jest.fn();
    const stop = watchShares({ takeInitial: () => ({ text: `Attukad Waterfalls\n${SHORT}`, subject: null }), addListener: () => () => undefined }, route);
    expect(route).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][0].text).toContain(SHORT);
    stop();
  });

  it('warm start: routes each share that arrives while the app is open, and stops listening on cleanup', () => {
    const route = jest.fn();
    let listener: ((s: { text: string; subject: string | null }) => void) | null = null;
    const unsubscribe = jest.fn();
    const stop = watchShares({ takeInitial: () => null, addListener: (fn) => ((listener = fn), unsubscribe) }, route);
    listener!({ text: SHORT, subject: 'Attukad Waterfalls' });
    expect(route).toHaveBeenCalledWith({ text: SHORT, subject: 'Attukad Waterfalls' });
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('opens the existing Add to a trip screen with the shared text', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as { router: { push: jest.Mock } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { routeShare } = require('../../shareIntake/ShareIntakeWatcher') as typeof import('../../shareIntake/ShareIntakeWatcher');
    routeShare({ text: `${ATTUKAD_LINE}\n${SHORT}`, subject: null });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/share/place', params: { text: `${ATTUKAD_LINE}\n${SHORT}`, subject: '' } });
  });
});
