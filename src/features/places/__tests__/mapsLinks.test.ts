import type { Place } from '../../planner/model';
import { journeyLegs, MAPS_LIMITS, MAPS_URL_MAX_LENGTH, navigateLink, placeLink, type JourneyLeg, type MapsTarget } from '../mapsLinks';

const place = (overrides: Partial<Place> = {}): Place => ({
  id: 'p',
  provider: 'google',
  providerPlaceId: 'ChIJ123',
  name: 'x',
  location: { latitude: 10.0889, longitude: 77.0595 },
  formattedAddress: 'Munnar, Kerala',
  types: [],
  district: null,
  state: null,
  country: null,
  metadata: {},
  fetchedAt: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});
const node = (name: string, p: Place | null = null) => ({ name, place: p });
const params = (url: string) => new URL(url).searchParams;

describe('single place links', () => {
  it('uses exact coordinates and the Place ID when known', () => {
    const link = navigateLink(node('Munnar', place()));
    expect(link.exact).toBe(true);
    expect(link.url.startsWith('https://www.google.com/maps/dir/?api=1')).toBe(true);
    expect(params(link.url).get('destination')).toBe('10.0889,77.0595');
    expect(params(link.url).get('destination_place_id')).toBe('ChIJ123');
    expect(params(link.url).has('origin')).toBe(false); // from the current location
    expect(params(placeLink(node('Munnar', place())).url).get('query_place_id')).toBe('ChIJ123');
  });

  it('falls back to a name search for places entered by hand, never invented coordinates', () => {
    const link = navigateLink(node('Echo Point'));
    expect(link.exact).toBe(false);
    expect(params(link.url).get('destination')).toBe('Echo Point');
    expect(params(placeLink(node('Kochi', place({ location: null, provider: 'manual', providerPlaceId: null, formattedAddress: 'Kerala' }))).url).get('query')).toBe('Kochi, Kerala');
  });
});

type Stop = ReturnType<typeof node>;
const named = (n: number) => Array.from({ length: n }, (_, i) => node(`Stop ${i + 1}`));
const names = (stops: readonly Stop[]) => stops.map((s) => s.name);
const TARGETS: MapsTarget[] = ['app', 'browser'];

/** Every named location a leg's URL asks Google Maps for, in order. */
function urlLocations(url: string): string[] {
  const p = params(url);
  return [...(p.has('origin') ? [p.get('origin')!] : []), ...(p.get('waypoints')?.split('|') ?? []), p.get('destination')!];
}

/** Google's documented constraints for where the link opens (Maps URLs docs; the Android app plans 10 locations). */
function expectWithinMobileLimits(leg: JourneyLeg<Stop>, target: MapsTarget) {
  const p = params(leg.url);
  expect(leg.url.startsWith('https://www.google.com/maps/dir/?api=1&')).toBe(true);
  expect(leg.url.length).toBeLessThanOrEqual(MAPS_URL_MAX_LENGTH);
  expect(p.get('waypoints')?.split('|').length ?? 0).toBeLessThanOrEqual(MAPS_LIMITS[target].maxWaypoints);
  expect(urlLocations(leg.url).length).toBeLessThanOrEqual(target === 'app' ? 10 : 5);
  expect(p.has('dir_action')).toBe(false);
  // Only unreserved characters and percent escapes after "?": nothing a Maps app or browser could misread.
  expect(leg.url.split('?')[1]).toMatch(/^[A-Za-z0-9_.~=&%-]+$/);
}

/** The journey reassembled from its legs: the first start, then every leg's stops. */
const covered = (legs: JourneyLeg<Stop>[]) => [...(legs[0]?.from ? [legs[0].from.name] : []), ...legs.flatMap((l) => names(l.stops))];

describe('whole-journey links', () => {
  it.each([2, 3, 4, 5, 9, 10])('%i locations: saved order, start and destination kept, nothing missing or repeated', (count) => {
    const stops = named(count);
    for (const target of TARGETS) {
      const legs = journeyLegs(stops, target);
      expect(covered(legs)).toEqual(names(stops));
      // The selected start is the first origin, the last place the final destination.
      expect(params(legs[0]!.url).get('origin')).toBe('Stop 1');
      expect(params(legs[legs.length - 1]!.url).get('destination')).toBe(`Stop ${count}`);
      // URL contents match the leg, in order.
      for (const leg of legs) {
        expect(urlLocations(leg.url)).toEqual([leg.from!.name, ...names(leg.stops)]);
        expectWithinMobileLimits(leg, target);
      }
      // Every location is opened exactly once, except hand-over points (end of one leg, start of the next).
      const all = legs.flatMap((l) => urlLocations(l.url));
      expect(all.length).toBe(count + legs.length - 1);
      expect(new Set(all).size).toBe(count);
    }
  });

  it('carries up to 10 locations in one Google Maps app link', () => {
    for (const count of [2, 3, 4, 5, 9, 10]) expect(journeyLegs(named(count), 'app')).toHaveLength(1);
    const ten = params(journeyLegs(named(10), 'app')[0]!.url);
    expect(ten.get('origin')).toBe('Stop 1');
    expect(ten.get('waypoints')).toBe('Stop 2|Stop 3|Stop 4|Stop 5|Stop 6|Stop 7|Stop 8|Stop 9');
    expect(ten.get('destination')).toBe('Stop 10');
  });

  it('splits longer journeys into linked legs, each starting where the last one ended', () => {
    const expected: Record<MapsTarget, Record<number, number[][]>> = {
      // [first, last] positions per leg
      app: { 10: [[1, 10]], 11: [[1, 10], [10, 11]], 19: [[1, 10], [10, 19]] },
      browser: { 5: [[1, 5]], 9: [[1, 5], [5, 9]], 10: [[1, 5], [5, 9], [9, 10]] },
    };
    for (const target of TARGETS) {
      for (const [count, spans] of Object.entries(expected[target])) {
        const legs = journeyLegs(named(Number(count)), target);
        expect(legs.map((l) => [l.firstPosition, l.lastPosition])).toEqual(spans);
        expect(legs.map((l) => l.number)).toEqual(spans.map((_, i) => i + 1));
        for (let i = 1; i < legs.length; i += 1) {
          const previous = legs[i - 1]!;
          expect(legs[i]!.from).toBe(previous.stops[previous.stops.length - 1]);
          expect(params(legs[i]!.url).get('origin')).toBe(params(previous.url).get('destination'));
        }
      }
    }
  });

  it('starts from the current location only when one place is left', () => {
    const [leg] = journeyLegs(named(1), 'app');
    expect(leg!.from).toBeNull();
    expect(params(leg!.url).has('origin')).toBe(false);
    expect(params(leg!.url).get('destination')).toBe('Stop 1');
  });

  it('URL-encodes names with spaces, commas and special characters', () => {
    const tricky = [node('Café “Rose” & Bakery'), node('Kochi, Kerala'), node('Fort #1 / Gate?'), node('A|B Junction'), node('50% Hill + View'), node('Echo  Point')];
    for (const target of TARGETS) {
      const legs = journeyLegs(tricky, target);
      for (const leg of legs) expectWithinMobileLimits(leg, target);
      expect(covered(legs)).toEqual(names(tricky));
      const decoded = legs.flatMap((l) => urlLocations(l.url));
      expect(decoded).toEqual(expect.arrayContaining(['Café “Rose” & Bakery', 'Kochi, Kerala', 'Fort #1 / Gate?', '50% Hill + View', 'Echo Point']));
      // "|" separates waypoints, so it never appears inside a name: no extra stop is created.
      expect(decoded).toContain('A/B Junction');
    }
    const url = journeyLegs(tricky, 'app')[0]!.url;
    expect(url).toContain('origin=Caf%C3%A9%20%E2%80%9CRose%E2%80%9D%20%26%20Bakery');
    expect(url).toContain('Kochi%2C%20Kerala%7CFort%20%231%20%2F%20Gate%3F');
    expect(url).not.toContain('+');
  });

  it('keeps every link under the URL length limit by using shorter legs', () => {
    const long = Array.from({ length: 6 }, (_, i) => node(`${'Very long place name '.repeat(8)}${i}`));
    const legs = journeyLegs(long, { maxWaypoints: 3, maxLength: 600 });
    for (const leg of legs) expect(leg.url.length).toBeLessThanOrEqual(600);
    expect(covered(legs)).toEqual(names(long));
  });

  it('passes waypoint Place IDs only when every waypoint has one', () => {
    const withIds = [node('A', place({ providerPlaceId: 'a' })), node('B', place({ providerPlaceId: 'b' })), node('C', place({ providerPlaceId: 'c' }))];
    const p = params(journeyLegs(withIds)[0]!.url);
    expect(p.get('origin_place_id')).toBe('a');
    expect(p.get('waypoint_place_ids')).toBe('b');
    expect(p.get('destination_place_id')).toBe('c');
    const mixed = [node('A'), node('B'), node('C', place({ providerPlaceId: 'c' })), node('D')];
    expect(params(journeyLegs(mixed)[0]!.url).has('waypoint_place_ids')).toBe(false);
  });

  it('returns nothing for an empty journey', () => {
    expect(journeyLegs([])).toEqual([]);
  });
});
