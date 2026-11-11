import { setupRepositories, tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds } from '../../../test/nodeSqliteDatabase';
import { tripOwner } from '../../features/preparation/model';
import { buildStarterChecklist } from '../../features/preparation/starter';
import { createChecklistRepository, insertPlan } from '../../features/preparation/checklistRepository';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

describe('migration 3: inventory and packing', () => {
  it('upgrades a v2 database without touching trips or checklists', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 2));
    const deps = { createId: sequentialIds('v2'), now: () => new Date('2026-11-01T00:00:00Z') };
    // v2-era rows written directly (today's trip repository targets the latest schema).
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category,
         created_at, updated_at) VALUES ('trip-1', 'Goa Getaway', 'North Goa', '2026-12-20', '2026-12-24', 2, 1,
         'car', 'beach', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [],
    );
    await db.runAsync(
      `INSERT INTO trip_destinations (id, trip_id, name, position, created_at, updated_at)
       VALUES ('d-1', 'trip-1', 'North Goa', 0, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [],
    );
    await db.withTransactionAsync(async () => {
      await insertPlan(db, tripOwner('trip-1'), buildStarterChecklist(tripInput()), {
        createId: deps.createId,
        timestamp: '2026-11-01T00:00:00Z',
      });
    });
    const checklists = createChecklistRepository(db, deps);
    const task = (await checklists.load(tripOwner('trip-1'))).tasks[0];
    await checklists.setTaskDone(task?.id ?? '', true);
    const tables = ['trips', 'trip_destinations'] as const;
    const before = await Promise.all(tables.map((t) => db.getAllAsync(`SELECT * FROM ${t}`, [])));
    const checklistBefore = await checklists.load(tripOwner('trip-1'));

    const result = await migrate(db, migrations.slice(0, 3));
    expect(result.applied).toEqual(['inventory_and_packing']);
    expect(await getSchemaVersion(db)).toBe(3);
    expect(await Promise.all(tables.map((t) => db.getAllAsync(`SELECT * FROM ${t}`, [])))).toEqual(before);
    expect(await checklists.load(tripOwner('trip-1'))).toEqual(checklistBefore);
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
