import type { Place } from '../../planner/model';
import { journeyLegs, MAPS_URL_MAX_WAYPOINTS, navigateLink, placeLink } from '../mapsLinks';

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

describe('whole-journey links', () => {
  const stops = Array.from({ length: 10 }, (_, i) => node(`Stop ${i + 1}`));

  it('fits a short journey in one link with waypoints', () => {
    const legs = journeyLegs(stops.slice(0, 3));
    expect(legs).toHaveLength(1);
    const p = params(legs[0]!.url);
    expect(p.get('destination')).toBe('Stop 3');
    expect(p.get('waypoints')).toBe('Stop 1|Stop 2');
    expect(p.has('origin')).toBe(false);
  });

  it('splits longer journeys into legs without dropping a stop', () => {
    const legs = journeyLegs(stops);
    const perLeg = MAPS_URL_MAX_WAYPOINTS + 1;
    expect(legs.map((l) => l.stops.length)).toEqual([perLeg, perLeg, 10 - 2 * perLeg]);
    expect(legs.flatMap((l) => l.stops.map((s) => s.name))).toEqual(stops.map((s) => s.name));
    // Each later leg starts where the previous one ended.
    expect(legs[1]!.from?.name).toBe('Stop 4');
    expect(params(legs[1]!.url).get('origin')).toBe('Stop 4');
    expect(params(legs[1]!.url).get('waypoints')!.split('|')).toHaveLength(MAPS_URL_MAX_WAYPOINTS);
    for (const leg of legs) expect(params(leg.url).get('waypoints')?.split('|').length ?? 0).toBeLessThanOrEqual(MAPS_URL_MAX_WAYPOINTS);
  });

  it('keeps every link under the URL length limit by using shorter legs', () => {
    const long = Array.from({ length: 6 }, (_, i) => node(`${'Very long place name '.repeat(8)}${i}`));
    const legs = journeyLegs(long, 3, 600);
    for (const leg of legs) expect(leg.url.length).toBeLessThanOrEqual(600);
    expect(legs.flatMap((l) => l.stops)).toHaveLength(6);
  });

  it('passes waypoint Place IDs only when every waypoint has one', () => {
    const withIds = [node('A', place({ providerPlaceId: 'a' })), node('B', place({ providerPlaceId: 'b' })), node('C', place({ providerPlaceId: 'c' }))];
    expect(params(journeyLegs(withIds)[0]!.url).get('waypoint_place_ids')).toBe('a|b');
    const mixed = [node('A', place({ providerPlaceId: 'a' })), node('B'), node('C')];
    expect(params(journeyLegs(mixed)[0]!.url).has('waypoint_place_ids')).toBe(false);
  });

  it('returns nothing for an empty journey', () => {
    expect(journeyLegs([])).toEqual([]);
  });
});
