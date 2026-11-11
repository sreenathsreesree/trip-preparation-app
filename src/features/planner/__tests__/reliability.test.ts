import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase, type TestDatabase } from '../../../../test/nodeSqliteDatabase';
import { orphanCounts, planViolations } from '../../../../test/planInvariants';
import type { Database } from '../../../db/types';
import { migrate } from '../../../db/migrate';
import { migrations } from '../../../db/migrations';
import { buildTree, PLANNER_LIMITS, routeNodes, type PlaceInput, type TripPlan } from '../model';
import { PlannerError } from '../plannerRepository';

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const place = (id: string, name: string): PlaceInput => ({
  provider: 'google',
  providerPlaceId: id,
  name,
  location: { latitude: 10, longitude: 77 },
});

const shape = (plan: TripPlan) => {
  const render = (items: ReturnType<typeof buildTree>): unknown[] =>
    items.map((i) => (i.children.length ? { [i.node.name]: render(i.children) } : i.node.name));
  return render(buildTree(plan.nodes));
};
const routeIds = (plan: TripPlan) => routeNodes(plan).map((n) => n.id);

/** Wraps a database so a chosen statement fails, to simulate an interrupted write. */
function failingDatabase(db: TestDatabase, shouldFail: (sql: string) => boolean): Database & { armed: boolean } {
  const wrapper = {
    armed: false,
    execAsync: (sql: string) => db.execAsync(sql),
    getFirstAsync: db.getFirstAsync.bind(db),
    getAllAsync: db.getAllAsync.bind(db),
    async runAsync(sql: string, params: Parameters<Database['runAsync']>[1]) {
      if (wrapper.armed && shouldFail(sql)) throw new Error('Simulated storage failure');
      return db.runAsync(sql, params);
    },
    withTransactionAsync: (task: () => Promise<void>) => db.withTransactionAsync(task),
  };
  return wrapper as unknown as Database & { armed: boolean };
}

describe('planner reliability: random operation sequences', () => {
  it.each([1, 7, 42])('keeps every invariant through 300 random operations (seed %i)', async (seed) => {
    const random = rng(seed);
    const pick = <T,>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)];
    const { db, trips, planner } = await setupRepositories();
    const tripA = await trips.create(tripInput({ name: 'A', destinations: [{ name: 'Munnar' }] }), { sections: [] });
    const tripB = await trips.create(tripInput({ name: 'B', destinations: [] }), { sections: [] });
    const tripIds = [tripA.id, tripB.id];
    let counter = 0;
    let expectedErrors = 0;

    for (let step = 0; step < 300; step += 1) {
      const tripId = pick(tripIds) as string;
      const before = await planner.load(tripId);
      const nodes = before.nodes;
      const node = pick(nodes);
      const op = Math.floor(random() * 11);
      let routeOp = false;
      let removed: string[] = [];
      counter += 1;
      try {
        if (op <= 1 || !node) {
          await planner.addNode(tripId, {
            name: `Place ${counter}`,
            parentId: random() < 0.6 ? (node?.id ?? null) : null,
            index: random() < 0.3 ? Math.floor(random() * 5) : undefined,
            addToRoute: random() < 0.4,
            place: random() < 0.25 ? place(`g-${Math.floor(random() * 6)}`, `Shared ${counter}`) : null,
          });
          routeOp = true; // may append a stop
        } else if (op === 2) {
          await planner.updateNode(node.id, { name: random() < 0.5 ? `Renamed ${counter}` : node.name.toUpperCase() });
        } else if (op === 3 || op === 4) {
          const target = random() < 0.3 ? null : (pick(nodes)?.id ?? null);
          await planner.moveNode(node.id, { parentId: target, index: Math.floor(random() * 6) });
        } else if (op === 5) {
          await planner.promote(node.id);
        } else if (op === 6) {
          const mode = random() < 0.5 ? 'keepChildren' : 'withChildren';
          const all = new Set([node.id]);
          if (mode === 'withChildren') {
            for (let grew = true; grew; ) {
              grew = false;
              for (const n of nodes) {
                if (n.parentId && all.has(n.parentId) && !all.has(n.id)) {
                  all.add(n.id);
                  grew = true;
                }
              }
            }
          }
          removed = [...all];
          await planner.removeNode(node.id, mode);
        } else if (op === 7) {
          routeOp = true;
          await planner.addRouteStop(tripId, node.id, random() < 0.5 ? Math.floor(random() * 4) : undefined);
        } else if (op === 8) {
          routeOp = true;
          await planner.removeRouteStop(tripId, node.id);
        } else if (op === 9 && before.route.length > 0) {
          routeOp = true;
          const stop = pick(before.route);
          await planner.moveRouteStop(tripId, stop?.nodeId ?? '', Math.floor(random() * before.route.length));
        } else {
          await planner.updateNode(node.id, { notes: `Note ${counter}` });
        }
      } catch (error) {
        // Only refusals the planner explains are acceptable (cycles, depth, ...).
        expect(error).toBeInstanceOf(PlannerError);
        expectedErrors += 1;
      }

      for (const id of tripIds) {
        const issues = await planViolations(db, id);
        if (issues.length) throw new Error(`step ${step} (op ${op}): ${issues.join('; ')}`);
      }
      // Route integrity: only route actions (and removing stops' places) change the route.
      if (!routeOp) {
        const after = routeIds(await planner.load(tripId));
        expect(after).toEqual(routeIds(before).filter((id) => !removed.includes(id)));
      }
    }
    expect(await orphanCounts(db)).toEqual({ nodes: 0, nestedOrphans: 0, routeStops: 0, destinations: 0 });
    expect(expectedErrors).toBeGreaterThan(0); // the sequence did exercise refusals
    db.close();
  });
});

describe('planner reliability: interrupted writes roll back completely', () => {
  it.each([
    ['adding a main destination', 'INSERT INTO trip_destinations'],
    ['reordering main destinations', 'UPDATE trip_destinations'],
    ['removing a place', 'DELETE FROM trip_destinations'],
    ['moving a place', 'UPDATE trip_plan_nodes SET parent_id'],
  ])('%s', async (_label, failingSql) => {
    const base = openTestDatabase();
    const db = failingDatabase(base, (sql) => sql.includes(failingSql));
    const { trips, planner } = await setupRepositories(db as unknown as TestDatabase);
    const trip = await trips.create(tripInput({ destinations: [{ name: 'Munnar' }, { name: 'Kochi' }] }), { sections: [] });
    const plan0 = await planner.load(trip.id);
    const munnar = plan0.nodes.find((n) => n.name === 'Munnar')?.id ?? '';
    const kochi = plan0.nodes.find((n) => n.name === 'Kochi')?.id ?? '';
    await planner.addNode(trip.id, { parentId: munnar, name: 'Echo Point', addToRoute: true });
    const before = await planner.load(trip.id);
    const tripBefore = await trips.getById(trip.id);

    db.armed = true;
    const attempt =
      failingSql === 'INSERT INTO trip_destinations'
        ? planner.addNode(trip.id, { name: 'Alleppey', addToRoute: true })
        : failingSql === 'UPDATE trip_destinations'
          ? planner.moveNode(kochi, { parentId: null, index: 0 })
          : failingSql === 'DELETE FROM trip_destinations'
            ? planner.removeNode(kochi, 'withChildren')
            : planner.moveNode(kochi, { parentId: munnar });
    await expect(attempt).rejects.toThrow('Simulated storage failure');
    db.armed = false;

    expect(await planner.load(trip.id)).toEqual(before);
    expect(await trips.getById(trip.id)).toEqual(tripBefore);
    expect(await planViolations(db, trip.id)).toEqual([]);
    base.close();
  });
});

describe('planner reliability: hierarchy edge cases', () => {
  it('supports nesting up to the limit and refuses one level more, by adding or by moving', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [] }), { sections: [] });
    let parentId: string | null = null;
    const chain: string[] = [];
    for (let depth = 0; depth < PLANNER_LIMITS.maxDepth; depth += 1) {
      const added = await planner.addNode(trip.id, { name: `Level ${depth}`, parentId });
      parentId = added.node.id;
      chain.push(parentId);
    }
    await expect(planner.addNode(trip.id, { name: 'Too deep', parentId })).rejects.toThrow(/nested up to/);

    const loose = (await planner.addNode(trip.id, { name: 'Loose' })).node.id;
    await planner.addNode(trip.id, { name: 'Loose child', parentId: loose });
    await expect(planner.moveNode(loose, { parentId: chain[PLANNER_LIMITS.maxDepth - 2] ?? null })).rejects.toThrow(
      /nested up to/,
    );
    await planner.moveNode(loose, { parentId: chain[PLANNER_LIMITS.maxDepth - 3] ?? null }); // fits exactly
    // A parent can never move into its own descendant, however deep.
    await expect(planner.moveNode(chain[0] ?? '', { parentId: chain[9] ?? null })).rejects.toThrow(/own places/);
    expect(await planViolations(db, trip.id)).toEqual([]);
    db.close();
  });

  it('keeps sibling order consistent when reordering after moves', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [{ name: 'A' }, { name: 'B' }] }), { sections: [] });
    const ids = Object.fromEntries((await planner.load(trip.id)).nodes.map((n) => [n.name, n.id]));
    const kids = [];
    for (const name of ['a1', 'a2', 'a3']) kids.push((await planner.addNode(trip.id, { name, parentId: ids.A })).node.id);
    await planner.moveNode(kids[0] ?? '', { parentId: ids.B ?? null });
    await planner.moveNode(kids[2] ?? '', { parentId: ids.A ?? null, index: 0 });
    await planner.moveNode(kids[0] ?? '', { parentId: ids.A ?? null, index: 1 });
    expect(shape(await planner.load(trip.id))).toEqual([{ A: ['a3', 'a1', 'a2'] }, 'B']);
    expect(await planViolations(db, trip.id)).toEqual([]);
    db.close();
  });

  it('allows similar hand-entered names but never the same provider place twice in a trip', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [{ name: 'Munnar' }] }), { sections: [] });
    for (const name of ['Echo Point', 'Echo point', 'Echo Point Lake']) {
      expect((await planner.addNode(trip.id, { name })).status).toBe('added');
    }
    expect((await planner.addNode(trip.id, { place: place('g-echo', 'Echo Point') })).status).toBe('added');
    const again = await planner.addNode(trip.id, { place: place('g-echo', 'Echo Pt (renamed by Google)') });
    expect(again.status).toBe('duplicate');
    expect((await planner.load(trip.id)).nodes.filter((n) => n.place?.providerPlaceId === 'g-echo')).toHaveLength(1);
    expect(await planViolations(db, trip.id)).toEqual([]);
    db.close();
  });

  it('treats repeated actions as no-ops', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [{ name: 'Munnar' }, { name: 'Kochi' }] }), { sections: [] });
    const plan = await planner.load(trip.id);
    const munnar = plan.nodes.find((n) => n.name === 'Munnar')?.id ?? '';
    await planner.addRouteStop(trip.id, munnar);
    await planner.addRouteStop(trip.id, munnar);
    await planner.promote(munnar); // already main
    await planner.moveNode(munnar, { parentId: null, index: 0 }); // already there
    const echo = (await planner.addNode(trip.id, { name: 'Echo', parentId: munnar })).node.id;
    await planner.removeRouteStop(trip.id, echo); // not a stop
    expect(await planner.load(trip.id)).toMatchObject({ route: plan.route.map((s) => expect.objectContaining({ nodeId: s.nodeId })) });
    expect(await planViolations(db, trip.id)).toEqual([]);
    db.close();
  });
});

describe('planner reliability: persistence and lifecycle', () => {
  it('duplicates a deep plan exactly, with the same route order and shared places', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [{ name: 'Munnar' }, { name: 'Athirappilly' }] }), {
      sections: [],
    });
    const ids = Object.fromEntries((await planner.load(trip.id)).nodes.map((n) => [n.name, n.id]));
    const dam = (await planner.addNode(trip.id, { name: 'Dam', parentId: ids.Munnar, place: place('g-dam', 'Dam') })).node.id;
    const boat = (await planner.addNode(trip.id, { name: 'Boating', parentId: dam, addToRoute: true })).node.id;
    await planner.addNode(trip.id, { name: 'Jetty', parentId: boat, place: place('g-jetty', 'Jetty'), addToRoute: true });
    await planner.addNode(trip.id, { name: 'Falls', parentId: ids.Athirappilly });
    await planner.moveRouteStop(trip.id, boat, 0);
    const original = await planner.load(trip.id);
    const placesBefore = await db.getAllAsync('SELECT * FROM places', []);

    const copy = await trips.duplicate(trip.id);
    const copied = await planner.load(copy.id);
    expect(shape(copied)).toEqual(shape(original));
    expect(routeNodes(copied).map((n) => n.name)).toEqual(routeNodes(original).map((n) => n.name));
    expect(copied.nodes.every((n) => !original.nodes.some((o) => o.id === n.id))).toBe(true);
    expect(await db.getAllAsync('SELECT * FROM places', [])).toEqual(placesBefore);
    expect(copy.destinations.map((d) => d.name)).toEqual(['Munnar', 'Athirappilly']);
    expect(await planViolations(db, copy.id)).toEqual([]);
    expect(await planner.load(trip.id)).toEqual(original);
    db.close();
  });

  it('deleting trips leaves no planner rows behind; saved places stay for reuse', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [{ name: 'Munnar' }] }), { sections: [] });
    const munnar = (await planner.load(trip.id)).nodes[0]?.id ?? '';
    await planner.addNode(trip.id, { name: 'Dam', parentId: munnar, place: place('g-dam', 'Dam'), addToRoute: true });
    const copy = await trips.duplicate(trip.id);
    await trips.remove(trip.id);
    await trips.remove(copy.id);
    const left = await db.getFirstAsync<{ nodes: number; stops: number; dests: number; places: number }>(
      `SELECT (SELECT COUNT(*) FROM trip_plan_nodes) AS nodes, (SELECT COUNT(*) FROM trip_route_stops) AS stops,
              (SELECT COUNT(*) FROM trip_destinations) AS dests, (SELECT COUNT(*) FROM places) AS places`,
      [],
    );
    expect(left).toEqual({ nodes: 0, stops: 0, dests: 0, places: 1 });
    expect(await orphanCounts(db)).toEqual({ nodes: 0, nestedOrphans: 0, routeStops: 0, destinations: 0 });
    db.close();
  });

  it('empty trips stay valid through every action', async () => {
    const { db, trips, planner } = await setupRepositories();
    const trip = await trips.create(tripInput({ destinations: [] }), { sections: [] });
    expect(await planViolations(db, trip.id)).toEqual([]);
    await planner.setRoute(trip.id, []);
    const only = (await planner.addNode(trip.id, { name: 'Hampi', addToRoute: true })).node.id;
    await planner.removeNode(only, 'withChildren');
    expect(await planner.load(trip.id)).toEqual({ nodes: [], route: [] });
    expect((await trips.getById(trip.id))?.destinations).toEqual([]);
    expect(await planViolations(db, trip.id)).toEqual([]);
    const copy = await trips.duplicate(trip.id);
    expect(await planner.load(copy.id)).toEqual({ nodes: [], route: [] });
    db.close();
  });

  it('keeps a pre-Milestone-5 trip working: original destination ids survive planner edits', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 3));
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category,
         created_at, updated_at) VALUES ('old', 'Old trip', 'Manali', '2026-12-20', '2026-12-24', 1, 0, 'car',
         'mountains', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [],
    );
    for (const [id, name, position] of [
      ['d-manali', 'Manali', 0],
      ['d-kaza', 'Kaza', 1],
    ] as const) {
      await db.runAsync(
        `INSERT INTO trip_destinations (id, trip_id, name, position, created_at, updated_at)
         VALUES (?, 'old', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [id, name, position],
      );
    }
    const { trips, planner } = await setupRepositories(db);
    const plan = await planner.load('old');
    const manali = plan.nodes.find((n) => n.name === 'Manali')?.id ?? '';
    const kaza = plan.nodes.find((n) => n.name === 'Kaza')?.id ?? '';
    await planner.addNode('old', { name: 'Hadimba Temple', parentId: manali });
    await planner.moveNode(kaza, { parentId: null, index: 0 });
    await planner.updateNode(manali, { name: 'Manali Town' });
    const trip = await trips.getById('old');
    expect(trip?.destinations).toEqual([
      { id: 'd-kaza', name: 'Kaza' },
      { id: 'd-manali', name: 'Manali Town' },
    ]);
    expect(await planViolations(db, 'old')).toEqual([]);
    db.close();
  });

  it('survives closing and reopening the database file mid-plan', async () => {
    const { mkdtempSync, rmSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    const { join } = process.getBuiltinModule('node:path') as typeof import('node:path');
    const { tmpdir } = process.getBuiltinModule('node:os') as typeof import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'plan-'));
    const file = join(dir, 'trip.db');
    const first = await setupRepositories(openTestDatabase(file));
    const trip = await first.trips.create(tripInput({ destinations: [{ name: 'Munnar' }] }), { sections: [] });
    const munnar = (await first.planner.load(trip.id)).nodes[0]?.id ?? '';
    await first.planner.addNode(trip.id, { name: 'Echo', parentId: munnar, addToRoute: true });
    const before = await first.planner.load(trip.id);
    first.db.close();

    const second = await setupRepositories(openTestDatabase(file));
    expect(await second.planner.load(trip.id)).toEqual(before);
    expect(await planViolations(second.db, trip.id)).toEqual([]);
    second.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('planner reliability: large plans', () => {
  it('handles a 300-place plan: building, moving big subtrees, removing and duplicating', async () => {
    const { db, trips, planner } = await setupRepositories(undefined, '2026-11-10T08:00:00.000Z');
    const trip = await trips.create(tripInput({ destinations: [] }), { sections: [] });
    const mains: string[] = [];
    for (let m = 0; m < 10; m += 1) mains.push((await planner.addNode(trip.id, { name: `Region ${m}`, addToRoute: true })).node.id);
    const started = Date.now();
    for (let i = 0; i < 290; i += 1) {
      const parentId = i % 3 === 0 ? (mains[i % 10] ?? null) : undefined;
      const plan = i % 3 === 0 ? null : await planner.load(trip.id);
      const parent = parentId ?? plan?.nodes[Math.floor((i * 7919) % (plan?.nodes.length ?? 1))]?.id ?? null;
      try {
        await planner.addNode(trip.id, { name: `Spot ${i}`, parentId: parent, addToRoute: i % 10 === 0 });
      } catch (error) {
        expect(error).toBeInstanceOf(PlannerError); // depth limit reached on a long chain
      }
    }
    const big = await planner.load(trip.id);
    expect(big.nodes.length).toBeGreaterThanOrEqual(250);
    const buildMs = Date.now() - started;

    await planner.moveNode(mains[0] ?? '', { parentId: mains[1] ?? null }); // a large subtree
    await planner.removeNode(mains[2] ?? '', 'keepChildren');
    await planner.removeNode(mains[3] ?? '', 'withChildren');
    const copy = await trips.duplicate(trip.id);
    expect(await planViolations(db, trip.id)).toEqual([]);
    expect(await planViolations(db, copy.id)).toEqual([]);
    expect(shape(await planner.load(copy.id))).toEqual(shape(await planner.load(trip.id)));
    // Informational: building ~300 places one by one through the repository.
    expect(buildMs).toBeLessThan(30_000);
    db.close();
  });
});
