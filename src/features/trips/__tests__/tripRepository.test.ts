import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';

import { openTestDatabase, sequentialIds, type TestDatabase } from '../../../../test/nodeSqliteDatabase';
import { createPrepItemRepository } from '../../preparation/prepItemRepository';
import { buildStarterChecklist } from '../../preparation/templates';
import type { NewTripInput } from '../model';
import { createTripRepository } from '../tripRepository';

const NOW = new Date('2026-11-10T08:00:00.000Z');

const goa: NewTripInput = {
  name: 'Goa Getaway',
  destination: 'North Goa',
  startDate: '2026-12-20',
  endDate: '2026-12-24',
  travellers: { adults: 2, children: 1 },
  transportMode: 'car',
  category: 'beach',
};

async function setup(db: TestDatabase = openTestDatabase()) {
  await migrate(db, migrations);
  const deps = { createId: sequentialIds(), now: () => NOW };
  return { db, trips: createTripRepository(db, deps), items: createPrepItemRepository(db, deps) };
}

describe('tripRepository', () => {
  it('creates a trip and reads it back with typed fields', async () => {
    const { db, trips } = await setup();
    const created = await trips.create(goa);

    expect(created).toEqual({
      id: 'id-1',
      ...goa,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      progress: { total: 0, done: 0 },
    });
    expect(await trips.getById('id-1')).toEqual(created);
    expect(await trips.getById('missing')).toBeNull();
    db.close();
  });

  it('stores the starter checklist atomically and reports progress', async () => {
    const { db, trips, items } = await setup();
    const starter = buildStarterChecklist(goa);
    const created = await trips.create(goa, { starterItems: starter });

    expect(created.progress).toEqual({ total: starter.length, done: 0 });

    const stored = await items.listByTrip(created.id);
    expect(stored).toHaveLength(starter.length);
    // Positions restart per section.
    const packing = stored.filter((item) => item.section === 'packing');
    expect(packing.map((item) => item.position)).toEqual(packing.map((_, index) => index));

    const first = stored[0];
    if (!first) throw new Error('expected an item');
    await items.setDone(first.id, true);
    const [summary] = await trips.list();
    expect(summary?.progress).toEqual({ total: starter.length, done: 1 });
    db.close();
  });

  it('lists trips by start date', async () => {
    const { db, trips } = await setup();
    await trips.create({ ...goa, name: 'Later', startDate: '2027-01-10', endDate: '2027-01-12' });
    await trips.create({ ...goa, name: 'Sooner', startDate: '2026-11-15', endDate: '2026-11-16' });

    expect((await trips.list()).map((trip) => trip.name)).toEqual(['Sooner', 'Later']);
    expect(await trips.count()).toBe(2);
    db.close();
  });

  it('deletes a trip and cascades to its checklist', async () => {
    const { db, trips, items } = await setup();
    const created = await trips.create(goa, { starterItems: buildStarterChecklist(goa) });

    expect(await trips.remove(created.id)).toBe(true);
    expect(await trips.remove(created.id)).toBe(false);
    expect(await items.listByTrip(created.id)).toEqual([]);
    expect(await items.countAll()).toBe(0);
    db.close();
  });

  it('rolls back the trip if a checklist insert fails', async () => {
    const { db, trips } = await setup();
    const badItems = [{ section: 'packing' as const, title: null as unknown as string }];

    await expect(trips.create(goa, { starterItems: badItems })).rejects.toThrow();
    expect(await trips.count()).toBe(0);
    db.close();
  });

  it('keeps trips after the database is closed and reopened (app restart)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trip-prep-'));
    const file = join(dir, 'trip-prep.db');
    try {
      const first = await setup(openTestDatabase(file));
      const created = await first.trips.create(goa, { starterItems: buildStarterChecklist(goa) });
      first.db.close();

      // Simulate a cold start: new connection, migrations run again.
      const second = await setup(openTestDatabase(file));
      const reloaded = await second.trips.list();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]).toEqual(created);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
