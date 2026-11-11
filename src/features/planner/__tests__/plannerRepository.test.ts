import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { buildTree, removalImpact, routeNodes, type PlaceInput, type TripPlan } from '../model';

const googlePlace = (id: string, name: string, lat = 10.08, lng = 77.06): PlaceInput => ({
  provider: 'google',
  providerPlaceId: id,
  name,
  location: { latitude: lat, longitude: lng },
  formattedAddress: `${name}, Kerala, India`,
  types: ['tourist_attraction'],
  state: 'Kerala',
  country: 'India',
});

const shape = (plan: TripPlan) => {
  const render = (items: ReturnType<typeof buildTree>): unknown[] =>
    items.map((i) => (i.children.length ? { [i.node.name]: render(i.children) } : i.node.name));
  return render(buildTree(plan.nodes));
};
const routeNames = (plan: TripPlan) => routeNodes(plan).map((n) => n.name);

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(
    tripInput({ name: 'Kerala Road Trip', destinations: [{ name: 'Munnar' }, { name: 'Athirappilly' }] }),
    { sections: [] },
  );
  const plan = await repos.planner.load(trip.id);
  const id = (name: string) => plan.nodes.find((n) => n.name === name)?.id ?? '';
  return { ...repos, trip, munnar: id('Munnar'), athirappilly: id('Athirappilly') };
}

describe('planner repository', () => {
  it('starts each trip with its destinations as main destinations and route stops', async () => {
    const { db, planner, trip } = await setup();
    const plan = await planner.load(trip.id);
    expect(shape(plan)).toEqual(['Munnar', 'Athirappilly']);
    expect(routeNames(plan)).toEqual(['Munnar', 'Athirappilly']);
    expect(plan.nodes.every((n) => n.origin === 'trip' && n.tripDestinationId)).toBe(true);
    db.close();
  });

  it('builds a nested hierarchy without changing the route', async () => {
    const { db, planner, trip, munnar, athirappilly } = await setup();
    await planner.addNode(trip.id, { parentId: munnar, place: googlePlace('g-choc', 'Chokramudi Point') });
    await planner.addNode(trip.id, { parentId: munnar, name: 'Echo Point' });
    const dam = await planner.addNode(trip.id, { parentId: munnar, place: googlePlace('g-dam', 'Mattupetty Dam') });
    await planner.addNode(trip.id, { parentId: dam.node.id, name: 'Nearby Attraction A' });
    await planner.addNode(trip.id, { parentId: athirappilly, place: googlePlace('g-falls', 'Athirappilly Waterfalls') });
    await planner.addNode(trip.id, { parentId: athirappilly, name: 'Vazhachal Waterfalls', index: 5 });

    const plan = await planner.load(trip.id);
    expect(shape(plan)).toEqual([
      { Munnar: ['Chokramudi Point', 'Echo Point', { 'Mattupetty Dam': ['Nearby Attraction A'] }] },
      { Athirappilly: ['Athirappilly Waterfalls', 'Vazhachal Waterfalls'] },
    ]);
    expect(routeNames(plan)).toEqual(['Munnar', 'Athirappilly']);
    expect(plan.nodes.find((n) => n.name === 'Mattupetty Dam')?.place).toMatchObject({
      providerPlaceId: 'g-dam',
      location: { latitude: 10.08, longitude: 77.06 },
      state: 'Kerala',
    });
    db.close();
  });

  it('never adds the same place twice to a trip, and reuses saved places across trips', async () => {
    const { db, planner, trips, trip, munnar, athirappilly } = await setup();
    const first = await planner.addNode(trip.id, { parentId: munnar, place: googlePlace('g-echo', 'Echo Point') });
    const again = await planner.addNode(trip.id, { parentId: athirappilly, place: googlePlace('g-echo', 'Echo Point') });
    expect(first.status).toBe('added');
    expect(again).toMatchObject({ status: 'duplicate', node: { id: first.node.id, parentId: munnar } });
    expect((await planner.load(trip.id)).nodes.filter((n) => n.place?.providerPlaceId === 'g-echo')).toHaveLength(1);

    const other = await trips.create(tripInput({ name: 'Second', destinations: [{ name: 'Kochi' }] }), { sections: [] });
    const reused = await planner.addNode(other.id, { place: googlePlace('g-echo', 'Echo Point') });
    expect(reused.status).toBe('added');
    expect(reused.node.placeId).toBe(first.node.placeId);
    const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM places', []);
    expect(rows[0]?.n).toBe(1);
    db.close();
  });

  it('moves, reorders, nests, unnests and promotes', async () => {
    const { db, planner, trip, munnar, athirappilly } = await setup();
    const a = (await planner.addNode(trip.id, { parentId: munnar, name: 'A' })).node.id;
    const b = (await planner.addNode(trip.id, { parentId: munnar, name: 'B' })).node.id;
    const c = (await planner.addNode(trip.id, { parentId: b, name: 'C' })).node.id;

    await planner.moveNode(b, { parentId: munnar, index: 0 }); // reorder
    expect(shape(await planner.load(trip.id))).toEqual([{ Munnar: [{ B: ['C'] }, 'A'] }, 'Athirappilly']);

    await planner.moveNode(b, { parentId: athirappilly }); // nest elsewhere, children follow
    expect(shape(await planner.load(trip.id))).toEqual([{ Munnar: ['A'] }, { Athirappilly: [{ B: ['C'] }] }]);

    await planner.promote(c); // right after its main destination
    expect(shape(await planner.load(trip.id))).toEqual([{ Munnar: ['A'] }, { Athirappilly: ['B'] }, 'C']);

    await planner.moveNode(athirappilly, { parentId: null, index: 0 }); // reorder main destinations
    await planner.moveNode(a, { parentId: null, index: 99 }); // unnest to the end
    const plan = await planner.load(trip.id);
    expect(shape(plan)).toEqual([{ Athirappilly: ['B'] }, 'Munnar', 'C', 'A']);
    const positions = plan.nodes.filter((n) => n.parentId === null).map((n) => n.position).sort();
    expect(positions).toEqual([0, 1, 2, 3]);
    db.close();
  });

  it('refuses moves that would create a cycle and leaves the tree unchanged', async () => {
    const { db, planner, trip, munnar } = await setup();
    const a = (await planner.addNode(trip.id, { parentId: munnar, name: 'A' })).node.id;
    const before = shape(await planner.load(trip.id));
    await expect(planner.moveNode(munnar, { parentId: a })).rejects.toThrow(/inside one of its own/);
    await expect(planner.moveNode(a, { parentId: a })).rejects.toThrow(/inside itself/);
    expect(shape(await planner.load(trip.id))).toEqual(before);
    db.close();
  });

  it('removes a place keeping what is inside it, or together with it, never touching unrelated places', async () => {
    const { db, planner, trip, munnar, athirappilly } = await setup();
    const dam = (await planner.addNode(trip.id, { parentId: munnar, name: 'Dam' })).node.id;
    await planner.addNode(trip.id, { parentId: dam, name: 'Boating' });
    await planner.addNode(trip.id, { parentId: munnar, name: 'Tea Museum' });
    const falls = (await planner.addNode(trip.id, { parentId: athirappilly, name: 'Falls', addToRoute: true })).node.id;
    await planner.addNode(trip.id, { parentId: falls, name: 'Viewpoint' });

    await planner.removeNode(dam, 'keepChildren');
    expect(shape(await planner.load(trip.id))).toEqual([
      { Munnar: ['Boating', 'Tea Museum'] },
      { Athirappilly: [{ Falls: ['Viewpoint'] }] },
    ]);
    await planner.removeNode(falls, 'withChildren');
    const plan = await planner.load(trip.id);
    expect(shape(plan)).toEqual([{ Munnar: ['Boating', 'Tea Museum'] }, 'Athirappilly']);
    expect(routeNames(plan)).toEqual(['Munnar', 'Athirappilly']); // its route stop went with it
    expect(plan.route.map((s) => s.position)).toEqual([0, 1]);
    db.close();
  });

  it('removing a main destination removes it from the trip, down to an empty plan', async () => {
    const { db, planner, trips, trip, munnar, athirappilly } = await setup();
    await planner.addNode(trip.id, { parentId: munnar, name: 'Tea Museum' });
    await planner.removeNode(munnar, 'keepChildren');
    // The place inside moved up and became a main destination itself.
    expect((await trips.getById(trip.id))?.destinations.map((d) => d.name)).toEqual(['Tea Museum', 'Athirappilly']);
    expect(shape(await planner.load(trip.id))).toEqual(['Tea Museum', 'Athirappilly']);
    await planner.removeNode(athirappilly, 'withChildren');
    const teaMuseum = (await planner.load(trip.id)).nodes[0]?.id ?? '';
    await planner.removeNode(teaMuseum, 'withChildren');
    expect((await trips.getById(trip.id))?.destinations).toEqual([]);
    expect(await planner.load(trip.id)).toEqual({ nodes: [], route: [] });
    db.close();
  });

  it('renaming a main destination renames the trip destination', async () => {
    const { db, planner, trips, trip, munnar } = await setup();
    await planner.updateNode(munnar, { name: 'Munnar Hills', notes: 'Stay 2 nights' });
    const updated = await trips.getById(trip.id);
    expect(updated?.destinations.map((d) => d.name)).toEqual(['Munnar Hills', 'Athirappilly']);
    expect((await planner.load(trip.id)).nodes.find((n) => n.id === munnar)?.notes).toBe('Stay 2 nights');
    await expect(planner.updateNode(munnar, { name: '  ' })).rejects.toThrow(/name/);
    db.close();
  });

  it('keeps an explicit, separately ordered route', async () => {
    const { db, planner, trip, munnar, athirappilly } = await setup();
    const echo = (await planner.addNode(trip.id, { parentId: munnar, name: 'Echo Point' })).node.id;
    await planner.addRouteStop(trip.id, echo, 1);
    expect(routeNames(await planner.load(trip.id))).toEqual(['Munnar', 'Echo Point', 'Athirappilly']);
    await planner.addRouteStop(trip.id, echo); // already a stop: no duplicate
    await planner.moveRouteStop(trip.id, athirappilly, 0);
    expect(routeNames(await planner.load(trip.id))).toEqual(['Athirappilly', 'Munnar', 'Echo Point']);
    await planner.removeRouteStop(trip.id, munnar);
    let plan = await planner.load(trip.id);
    expect(routeNames(plan)).toEqual(['Athirappilly', 'Echo Point']);
    expect(plan.nodes.some((n) => n.id === munnar)).toBe(true); // the place stays in the plan
    await planner.setRoute(trip.id, [echo, munnar, echo]);
    plan = await planner.load(trip.id);
    expect(routeNames(plan)).toEqual(['Echo Point', 'Munnar']);
    await expect(planner.setRoute(trip.id, ['not-a-node'])).rejects.toThrow(/not in this plan/);
    db.close();
  });

  it('main destinations are the trip destinations everywhere; nested places never are', async () => {
    const { db, planner, trips, trip, munnar, athirappilly } = await setup();
    const destinations = async () => (await trips.getById(trip.id))?.destinations.map((d) => d.name);
    const legacy = async () =>
      (await db.getFirstAsync<{ destination: string }>('SELECT destination FROM trips WHERE id = ?', [trip.id]))
        ?.destination;
    const munnarDestId = (await trips.getById(trip.id))?.destinations[0]?.id;

    // Adding a main destination (not a route stop unless asked) adds a trip destination.
    const kochi = (await planner.addNode(trip.id, { name: 'Kochi' })).node.id;
    await planner.addNode(trip.id, { parentId: munnar, name: 'Echo Point' });
    expect(await destinations()).toEqual(['Munnar', 'Athirappilly', 'Kochi']);
    expect(routeNames(await planner.load(trip.id))).toEqual(['Munnar', 'Athirappilly']);

    // Reordering main destinations reorders the trip; ids stay stable.
    await planner.moveNode(kochi, { parentId: null, index: 0 });
    expect(await destinations()).toEqual(['Kochi', 'Munnar', 'Athirappilly']);
    expect(await legacy()).toBe('Kochi');
    expect((await trips.getById(trip.id))?.destinations[1]?.id).toBe(munnarDestId);

    // Nesting a main destination removes it from the trip's destinations; promoting brings it back.
    await planner.moveNode(athirappilly, { parentId: munnar });
    expect(await destinations()).toEqual(['Kochi', 'Munnar']);
    await planner.promote(athirappilly);
    expect(await destinations()).toEqual(['Kochi', 'Munnar', 'Athirappilly']);

    // Renaming follows; the route never changed through any of this.
    await planner.updateNode(kochi, { name: 'Fort Kochi' });
    expect(await destinations()).toEqual(['Fort Kochi', 'Munnar', 'Athirappilly']);
    expect(routeNames(await planner.load(trip.id))).toEqual(['Munnar', 'Athirappilly']);

    // Editing trip details leaves destinations alone.
    await trips.update(trip.id, { ...tripInput(), name: 'Renamed trip' });
    expect(await destinations()).toEqual(['Fort Kochi', 'Munnar', 'Athirappilly']);
    expect(shape(await planner.load(trip.id))).toEqual(['Fort Kochi', { Munnar: ['Echo Point'] }, 'Athirappilly']);
    db.close();
  });

  it('starts a trip created without destinations with an empty plan', async () => {
    const { db, planner, trips } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [] }), { sections: [] });
    expect(await planner.load(trip.id)).toEqual({ nodes: [], route: [] });
    await planner.addNode(trip.id, { name: 'Hampi', addToRoute: true });
    expect((await trips.getById(trip.id))?.destinations.map((d) => d.name)).toEqual(['Hampi']);
    expect(routeNames(await planner.load(trip.id))).toEqual(['Hampi']);
    db.close();
  });

  it('describes what a removal does to the route before it happens', async () => {
    const { db, planner, trip, munnar } = await setup();
    const dam = (await planner.addNode(trip.id, { parentId: munnar, name: 'Dam', addToRoute: true })).node.id;
    await planner.addNode(trip.id, { parentId: dam, name: 'Boating' });
    const plan = await planner.load(trip.id);
    expect(removalImpact(plan, munnar, 'withChildren')).toEqual({
      removedNodes: 3,
      movedUp: 0,
      routeStops: ['Munnar', 'Dam'],
      removesMainDestination: true,
    });
    expect(removalImpact(plan, munnar, 'keepChildren')).toMatchObject({ removedNodes: 1, movedUp: 1, routeStops: ['Munnar'] });
    expect(removalImpact(plan, dam, 'keepChildren')).toMatchObject({ routeStops: ['Dam'], removesMainDestination: false });
    db.close();
  });

  it('duplicating a trip copies its plan and route; deleting a trip removes only its plan', async () => {
    const { db, planner, trips, trip, munnar } = await setup();
    await planner.addNode(trip.id, { parentId: munnar, place: googlePlace('g-echo', 'Echo Point'), addToRoute: true });
    const copy = await trips.duplicate(trip.id);
    const copied = await planner.load(copy.id);
    expect(shape(copied)).toEqual([{ Munnar: ['Echo Point'] }, 'Athirappilly']);
    expect(routeNames(copied)).toEqual(['Munnar', 'Athirappilly', 'Echo Point']);
    expect(copied.nodes.filter((n) => n.tripDestinationId).map((n) => n.tripDestinationId).sort()).toEqual(
      copy.destinations.map((d) => d.id).sort(),
    );

    await trips.remove(trip.id);
    expect((await planner.load(copy.id)).nodes).toHaveLength(3);
    expect((await planner.listPlaces()).map((p) => p.providerPlaceId)).toEqual(['g-echo']);
    db.close();
  });

  it('remembers the most recently opened active trip planner', async () => {
    const { db, planner, trips, trip } = await setup();
    expect(await planner.lastOpenedTripId()).toBeNull();
    const other = await trips.create(tripInput({ name: 'Other' }), { sections: [] });
    await planner.markOpened(trip.id);
    await planner.markOpened(other.id);
    expect(await planner.lastOpenedTripId()).toBe(other.id);
    await trips.setArchived(other.id, true);
    expect(await planner.lastOpenedTripId()).toBe(trip.id);
    db.close();
  });

  it('expires provider content after the cache limit but keeps Place IDs and the user’s plan', async () => {
    const { db, planner, trip, munnar, advanceClock } = await setup();
    await planner.addNode(trip.id, { parentId: munnar, place: googlePlace('g-echo', 'Echo Point') });
    await planner.addNode(trip.id, { parentId: munnar, name: 'Hand-written spot' });
    expect(await planner.expireProviderCache()).toBe(0);

    advanceClock(31 * 24 * 60 * 60 * 1000);
    expect(await planner.expireProviderCache()).toBe(1);
    const plan = await planner.load(trip.id);
    const echo = plan.nodes.find((n) => n.name === 'Echo Point');
    expect(echo?.place).toMatchObject({ providerPlaceId: 'g-echo', location: null, formattedAddress: '', fetchedAt: null });
    expect(shape(plan)).toEqual([{ Munnar: ['Echo Point', 'Hand-written spot'] }, 'Athirappilly']);

    // Refreshing from the provider restores the details on the same row.
    const refreshed = await planner.upsertPlace(googlePlace('g-echo', 'Echo Point'));
    expect(refreshed).toMatchObject({ id: echo?.placeId, location: { latitude: 10.08, longitude: 77.06 } });
    db.close();
  });

  it('validates input', async () => {
    const { db, planner, trip, munnar } = await setup();
    await expect(planner.addNode(trip.id, { name: '' })).rejects.toThrow(/name/);
    await expect(planner.addNode('missing-trip', { name: 'X' })).rejects.toThrow(/no longer exists/);
    await expect(planner.addNode(trip.id, { parentId: 'missing', name: 'X' })).rejects.toThrow(/no longer in this plan/);
    await expect(
      planner.addNode(trip.id, { parentId: munnar, place: { provider: 'google', providerPlaceId: null, name: 'X' } }),
    ).rejects.toThrow(/provider place id/);
    const bad = await planner.upsertPlace({ ...googlePlace('g-bad', 'Bad coords'), location: { latitude: 200, longitude: 0 } });
    expect(bad.location).toBeNull();
    db.close();
  });
});
