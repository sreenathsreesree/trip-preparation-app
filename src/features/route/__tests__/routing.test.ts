import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { journeyLegs } from '../../places/mapsLinks';
import { routeNodes } from '../../planner/model';
import { createRemoteCacheRepository } from '../../remote/remoteCacheRepository';
import { optimisedOrder, restorableOrder } from '../routeUndoRepository';
import { chunks, DEFAULT_OSRM_URL, formatDuration, formatKm, locatedRuns, osrmBase, parseRoute, routeLegs, suggestOrder, type RouteStop } from '../routing';

const at = (lat: number, lon: number) => ({ latitude: lat, longitude: lon });
const stop = (id: string, location: ReturnType<typeof at> | null = at(10, 77)): RouteStop => ({ id, name: id, location });
const json = (b: unknown) => new Response(JSON.stringify(b));
/** An OSRM-format reply: each leg 1000 m × index, 60 s × index. */
const osrm = jest.fn(async (url: string) => {
  const n = url.split('/driving/')[1]!.split('?')[0]!.split(';').length;
  return json({ code: 'Ok', routes: [{ legs: Array.from({ length: n - 1 }, (_, i) => ({ distance: 1000 * (i + 1), duration: 60 * (i + 1) })) }] });
}) as unknown as jest.Mock & typeof fetch;

beforeEach(() => osrm.mockClear());

async function cache() {
  return createRemoteCacheRepository((await setupRepositories()).database);
}

describe('road legs (OSRM)', () => {
  it('reads leg distances and times; anything malformed is "no route", never a guess', () => {
    expect(parseRoute({ code: 'Ok', routes: [{ legs: [{ distance: 5300, duration: 600 }] }] }, 2)).toEqual([{ meters: 5300, seconds: 600 }]);
    expect(parseRoute({ code: 'NoRoute' }, 2)).toBeNull();
    expect(parseRoute({ code: 'Ok', routes: [{ legs: [] }] }, 2)).toBeNull();
    expect(osrmBase(undefined)).toBe(DEFAULT_OSRM_URL);
    expect(osrmBase('http://insecure')).toBe(DEFAULT_OSRM_URL);
  });

  it('measures runs of located stops; legs touching a stop without a location are unavailable (no straight-line stand-in)', async () => {
    const stops = [stop('a', at(10, 77)), stop('b', at(10.1, 77)), stop('x', null), stop('c', at(10.2, 77)), stop('d', at(10.3, 77))];
    expect(locatedRuns(stops).map((r) => r.map((s) => s.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const r = await routeLegs(stops, { cache: await cache(), fetchImpl: osrm });
    expect(r.legs.map((l) => [l.fromId, l.toId, l.meters, l.reason ?? null])).toEqual([
      ['a', 'b', 1000, null],
      ['b', 'x', null, 'missing_location'],
      ['x', 'c', null, 'missing_location'],
      ['c', 'd', 1000, null],
    ]);
    expect([r.totalMeters, r.totalSeconds, r.covered, r.from]).toEqual([2000, 120, 2, 'live']);
  });

  it('splits long journeys into overlapping requests so no leg is lost', async () => {
    expect(chunks([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [3, 4, 5],
      [5, 6],
    ]);
    const many = Array.from({ length: 30 }, (_, i) => stop(`s${i}`, at(10 + i / 100, 77)));
    const r = await routeLegs(many, { cache: await cache(), fetchImpl: osrm });
    expect(r.legs).toHaveLength(29);
    expect(r.covered).toBe(29);
    expect(osrm).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('is cached: the same journey is not requested again; offline shows the saved legs as saved', async () => {
    const c = await cache();
    const stops = [stop('a', at(10, 77)), stop('b', at(10.1, 77))];
    await routeLegs(stops, { cache: c, fetchImpl: osrm, now: new Date('2026-11-13T00:00:00Z') });
    expect((await routeLegs(stops, { cache: c, fetchImpl: osrm, now: new Date('2026-11-14T00:00:00Z') })).from).toBe('cache');
    expect(osrm).toHaveBeenCalledTimes(1);
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const old = await routeLegs(stops, { cache: c, fetchImpl: offline, now: new Date('2027-01-01T00:00:00Z') });
    expect([old.from, old.covered]).toEqual(['stale_cache', 1]);
    const none = await routeLegs([stop('p', at(20, 70)), stop('q', at(20.1, 70))], { cache: c, fetchImpl: offline });
    expect([none.covered, none.legs[0]!.reason]).toEqual([0, 'offline']);
  }, 15_000);

  it('formats road distance and time', () => {
    expect([formatKm(850), formatKm(12_345), formatDuration(3_000), formatDuration(9_000)]).toEqual(['850 m', '12.3 km', '50 min', '2 h 30 min']);
  });
});

describe('optimisation is a proposal, with undo', () => {
  it('suggests an order from the trip service; first and last stay; needs every location', async () => {
    const trip = jest.fn(async () => json({ code: 'Ok', waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }, { waypoint_index: 3 }] })) as unknown as typeof fetch;
    expect(await suggestOrder([stop('a'), stop('b'), stop('c'), stop('d')], { fetchImpl: trip })).toEqual(['a', 'c', 'b', 'd']);
    expect(await suggestOrder([stop('a'), stop('b', null), stop('c'), stop('d')], { fetchImpl: trip })).toBeNull();
    expect(await suggestOrder([stop('a'), stop('b'), stop('c')], { fetchImpl: trip })).toBeNull();
  });

  it('visited stops keep their places; an unchanged order is no proposal; a saved order is restored safely', () => {
    expect(optimisedOrder(['v', 'a', 'b', 'c'], new Set(['v']), ['a', 'c', 'b'])).toEqual(['v', 'a', 'c', 'b']);
    expect(optimisedOrder(['a', 'b', 'c'], new Set(), ['a', 'b', 'c'])).toBeNull();
    expect(optimisedOrder(['a', 'b'], new Set(), ['a', 'x'])).toBeNull();
    expect(restorableOrder(['a', 'b', 'gone', 'c'], ['c', 'a', 'new', 'b'])).toEqual(['a', 'b', 'c', 'new']);
  });

  it('applying and restoring an order changes only the route — hierarchy and Google Maps legs follow the order', async () => {
    const r = await setupRepositories();
    const t = await r.trips.create(tripInput({ name: 'K', destinations: [] }), { sections: [] });
    const munnar = (await r.planner.addNode(t.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
    const echo = (await r.planner.addNode(t.id, { name: 'Echo Point', parentId: munnar.id, addToRoute: true })).node;
    const kochi = (await r.planner.addNode(t.id, { name: 'Kochi', parentId: null, addToRoute: true })).node;
    const before = await r.planner.load(t.id);
    await r.planner.setRoute(t.id, [kochi.id, echo.id, munnar.id]);
    const after = await r.planner.load(t.id);
    expect(routeNodes(after).map((n) => n.name)).toEqual(['Kochi', 'Echo Point', 'Munnar']);
    expect(after.nodes.find((n) => n.id === echo.id)?.parentId).toBe(munnar.id);
    expect(after.nodes.map((n) => [n.id, n.parentId]).sort()).toEqual(before.nodes.map((n) => [n.id, n.parentId]).sort());
    const legs = journeyLegs(routeNodes(after), 'app');
    expect(new URL(legs[0]!.url).searchParams.get('origin')).toBe('Kochi');
    await r.planner.setRoute(t.id, routeNodes(before).map((n) => n.id));
    expect(routeNodes(await r.planner.load(t.id)).map((n) => n.name)).toEqual(['Munnar', 'Echo Point', 'Kochi']);
  });
});
