import { tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds } from '../../../test/nodeSqliteDatabase';
import { planViolations } from '../../../test/planInvariants';
import { createPlannerRepository } from '../../features/planner/plannerRepository';
import { createTripRepository } from '../../features/trips/tripRepository';
import { migrate } from '../migrate';
import { migrations } from '../migrations';
import { serializeTransactions } from '../serialize';

async function setup(serialized: boolean) {
  const raw = openTestDatabase();
  const db = serialized ? serializeTransactions(raw) : raw;
  await migrate(db, migrations);
  const deps = { createId: sequentialIds(), now: () => new Date('2026-11-10T08:00:00Z') };
  const trips = createTripRepository(db, deps);
  const planner = createPlannerRepository(db, deps);
  const trip = await trips.create(tripInput({ destinations: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), {
    sections: [],
  });
  return { raw, db, trips, planner, trip };
}

/** Rapid taps: several writes started before the previous one finished. */
async function burst(planner: Awaited<ReturnType<typeof setup>>['planner'], tripId: string) {
  const plan = await planner.load(tripId);
  const [a, b, c] = plan.nodes.map((n) => n.id);
  return Promise.allSettled([
    planner.moveNode(c ?? '', { parentId: null, index: 0 }),
    planner.addNode(tripId, { name: 'D', addToRoute: true }),
    planner.moveNode(a ?? '', { parentId: b ?? null }),
    planner.moveRouteStop(tripId, b ?? '', 0),
    planner.updateNode(b ?? '', { name: 'B2' }),
  ]);
}

describe('serialized transactions', () => {
  it('without serialization, overlapping writes on one connection collide (the bug)', async () => {
    const { raw, planner, trip } = await setup(false);
    const results = await burst(planner, trip.id);
    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    raw.close();
  });

  it('with serialization, overlapping writes all succeed, in order, leaving a valid plan', async () => {
    const { raw, db, planner, trips, trip } = await setup(true);
    const results = await burst(planner, trip.id);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect((await trips.getById(trip.id))?.destinations.map((d) => d.name)).toEqual(['C', 'B2', 'D']);
    expect(await planViolations(db, trip.id)).toEqual([]);
    raw.close();
  });

  it('a failed transaction does not block the ones queued after it', async () => {
    const { raw, db } = await setup(true);
    const failing = db.withTransactionAsync(async () => {
      await db.runAsync("UPDATE trips SET name = 'temp'", []);
      throw new Error('boom');
    });
    const next = db.withTransactionAsync(async () => {
      await db.runAsync("UPDATE trips SET name = 'after'", []);
    });
    await expect(failing).rejects.toThrow('boom');
    await next;
    expect((await db.getFirstAsync<{ name: string }>('SELECT name FROM trips', []))?.name).toBe('after');
    raw.close();
  });
});
