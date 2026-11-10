import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';

import { openTestDatabase, sequentialIds } from '../../../../test/nodeSqliteDatabase';
import { createTripRepository } from '../../trips/tripRepository';
import { createPrepItemRepository } from '../prepItemRepository';

async function setup() {
  const db = openTestDatabase();
  await migrate(db, migrations);
  const deps = { createId: sequentialIds(), now: () => new Date('2026-11-10T08:00:00Z') };
  const trips = createTripRepository(db, deps);
  const items = createPrepItemRepository(db, deps);
  const trip = await trips.create({
    name: 'Rishikesh',
    destination: 'Rishikesh',
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    travellers: { adults: 1, children: 0 },
    transportMode: 'bus',
    category: 'adventure',
  });
  return { db, items, trip };
}

describe('prepItemRepository', () => {
  it('adds items with normalised titles and increasing positions', async () => {
    const { db, items, trip } = await setup();
    const a = await items.add(trip.id, 'packing', '  Rain   jacket ');
    const b = await items.add(trip.id, 'packing', "Hiker's boots");
    const c = await items.add(trip.id, 'documents', 'Aadhaar card');

    expect(a.title).toBe('Rain jacket');
    expect([a.position, b.position, c.position]).toEqual([0, 1, 0]);
    expect((await items.listByTrip(trip.id)).map((item) => item.title)).toEqual([
      'Aadhaar card',
      'Rain jacket',
      "Hiker's boots",
    ]);
    db.close();
  });

  it('rejects empty and overly long titles', async () => {
    const { db, items, trip } = await setup();
    await expect(items.add(trip.id, 'packing', '   ')).rejects.toThrow(/empty/);
    await expect(items.add(trip.id, 'packing', 'x'.repeat(121))).rejects.toThrow(/120/);
    db.close();
  });

  it('toggles and removes items', async () => {
    const { db, items, trip } = await setup();
    const item = await items.add(trip.id, 'shopping', 'Sunscreen');

    await items.setDone(item.id, true);
    expect((await items.listByTrip(trip.id))[0]?.isDone).toBe(true);
    await items.setDone(item.id, false);
    expect((await items.listByTrip(trip.id))[0]?.isDone).toBe(false);

    await items.remove(item.id);
    expect(await items.listByTrip(trip.id)).toEqual([]);
    await expect(items.setDone(item.id, true)).rejects.toThrow(/no longer exists/);
    db.close();
  });

  it('rejects items for a trip that does not exist (foreign key)', async () => {
    const { db, items } = await setup();
    await expect(items.add('ghost-trip', 'packing', 'Socks')).rejects.toThrow();
    db.close();
  });
});
