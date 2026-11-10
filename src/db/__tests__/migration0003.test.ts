import { setupRepositories, tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds } from '../../../test/nodeSqliteDatabase';
import { tripOwner } from '../../features/preparation/model';
import { buildStarterChecklist } from '../../features/preparation/starter';
import { createTripRepository } from '../../features/trips/tripRepository';
import { createChecklistRepository } from '../../features/preparation/checklistRepository';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

describe('migration 3: inventory and packing', () => {
  it('upgrades a v2 database without touching trips or checklists', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 2));
    const deps = { createId: sequentialIds('v2'), now: () => new Date('2026-11-01T00:00:00Z') };
    const trips = createTripRepository(db, deps);
    const checklists = createChecklistRepository(db, deps);
    const trip = await trips.create(tripInput(), buildStarterChecklist(tripInput()));
    const task = (await checklists.load(tripOwner(trip.id))).tasks[0];
    await checklists.setTaskDone(task?.id ?? '', true);
    const tripBefore = await trips.getById(trip.id);
    const checklistBefore = await checklists.load(tripOwner(trip.id));

    const result = await migrate(db, migrations);
    expect(result.applied).toEqual(['inventory_and_packing']);
    expect(await getSchemaVersion(db)).toBe(3);
    expect(await trips.getById(trip.id)).toEqual(tripBefore);
    expect(await checklists.load(tripOwner(trip.id))).toEqual(checklistBefore);
    db.close();
  });

  it('seeds the starter categories and subcategories', async () => {
    const { db, inventory } = await setupRepositories();
    const categories = await inventory.listCategories();
    const top = categories.filter((c) => !c.parentId);
    expect(top.map((c) => c.name)).toEqual([
      'Clothing',
      'Footwear',
      'Toiletries',
      'Electronics',
      'Documents',
      'Medicines and first aid',
      'Travel accessories',
      'Camping and outdoor',
      'Photography',
      'Food and essentials',
      'Miscellaneous',
    ]);
    expect(top.every((c) => c.systemKey !== null)).toBe(true);
    const clothing = top.find((c) => c.systemKey === 'clothing');
    expect(categories.filter((c) => c.parentId === clothing?.id).map((c) => c.name)).toEqual([
      'Tops',
      'Bottoms',
      'Outerwear',
      'Innerwear and sleepwear',
    ]);
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length);
    db.close();
  });
});
