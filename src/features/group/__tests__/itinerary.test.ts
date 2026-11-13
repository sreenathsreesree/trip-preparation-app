import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { journeyLegs } from '../../places/mapsLinks';
import { copyGroupItinerary, groupRoute, planToGroupPlaces } from '../itinerary';

describe('shared itinerary', () => {
  async function owner() {
    const r = await setupRepositories(undefined, '2026-11-13T08:00:00.000Z', 'o');
    const t = await r.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
    const munnar = (await r.planner.addNode(t.id, { name: 'Munnar', parentId: null, addToRoute: true, place: { provider: 'manual', providerPlaceId: null, name: 'Munnar', location: { latitude: 10.0889, longitude: 77.0595 } } })).node;
    const echo = (await r.planner.addNode(t.id, { name: 'Echo Point', parentId: munnar.id, addToRoute: true, notes: 'My private note' })).node;
    await r.planner.addNode(t.id, { name: 'Kochi', parentId: null, addToRoute: true });
    await r.companion.saveMemory(munnar.id, { notes: 'Private memory', photos: ['file:///private.jpg'] });
    await r.dayPlan.set(t.id, echo.id, { dayNumber: 2, date: '2026-11-21' });
    return { r, t, munnar, echo };
  }

  it('publishing sends names, nesting, route order, days and locations — never notes, memories or photos', async () => {
    const { r, t, munnar } = await owner();
    const places = planToGroupPlaces(await r.planner.load(t.id), await r.dayPlan.list(t.id));
    expect(places.map((p) => [p.data.name, p.data.parentId, p.data.routePosition, p.data.day])).toEqual(
      expect.arrayContaining([
        ['Munnar', null, 0, null],
        ['Echo Point', `place-${munnar.id}`, 1, 2],
        ['Kochi', null, 2, null],
      ]),
    );
    expect(JSON.stringify(places)).not.toMatch(/private|file:\/\//i);
    expect(Object.keys(places[0]!.data).sort()).toEqual(['date', 'day', 'location', 'name', 'parentId', 'position', 'routePosition', 'visited']);
  });

  it('a member adds the group plan to their own plan: nesting, route and days kept, existing places reused, nothing removed', async () => {
    const { r, t } = await owner();
    const o = r.group;
    for (const p of planToGroupPlaces(await r.planner.load(t.id), await r.dayPlan.list(t.id))) await o.save(t.id, { id: p.id, kind: 'place', data: p.data as never }, { id: 'owner' });
    const items = await o.list(t.id, 'place');

    const m = await setupRepositories(undefined, '2026-11-13T08:00:00.000Z', 'm');
    const mt = await m.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
    await m.planner.addNode(mt.id, { name: 'Kochi', parentId: null, addToRoute: false, notes: 'Member’s own' });
    const result = await copyGroupItinerary(mt.id, items, { planner: m.planner, dayPlan: m.dayPlan });
    expect(result).toEqual({ added: 2, reused: 1 });
    const plan = await m.planner.load(mt.id);
    const byName = new Map(plan.nodes.map((n) => [n.name, n]));
    expect(byName.get('Echo Point')?.parentId).toBe(byName.get('Munnar')?.id);
    expect(byName.get('Kochi')?.notes).toBe('Member’s own');
    expect((await m.dayPlan.list(mt.id)).find((d) => d.nodeId === byName.get('Echo Point')?.id)).toMatchObject({ dayNumber: 2 });
    expect(await copyGroupItinerary(mt.id, items, { planner: m.planner, dayPlan: m.dayPlan })).toEqual({ added: 0, reused: 3 });
  });

  it('the group route feeds the same Google Maps links as Navigation (order, visited skipped)', async () => {
    const { r, t } = await owner();
    for (const p of planToGroupPlaces(await r.planner.load(t.id), await r.dayPlan.list(t.id))) await r.group.save(t.id, { id: p.id, kind: 'place', data: p.data as never }, { id: 'owner' });
    const items = await r.group.list(t.id, 'place');
    const route = groupRoute(items);
    expect(route.map((x) => x.name)).toEqual(['Munnar', 'Echo Point', 'Kochi']);
    const munnar = items.find((i) => i.data.name === 'Munnar')!;
    await r.group.save(t.id, { id: munnar.id, kind: 'place', data: { ...munnar.data, visited: true } }, { id: 'owner' });
    const upcoming = groupRoute(await r.group.list(t.id, 'place')).filter((x) => !x.visited);
    const url = new URL(journeyLegs(upcoming as never, 'app')[0]!.url);
    expect([url.searchParams.get('origin'), url.searchParams.get('destination')]).toEqual(['Echo Point', 'Kochi']);
  });
});
