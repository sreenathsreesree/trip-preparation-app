import { itemInput, tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds, type TestDatabase } from '../../../test/nodeSqliteDatabase';
import { createInventoryRepository } from '../../features/inventory/inventoryRepository';
import { createPackingRepository } from '../../features/packing/packingRepository';
import { createTripRepository } from '../../features/trips/tripRepository';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

const T = '2026-11-01T00:00:00Z';

async function snapshot(db: TestDatabase) {
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
    [],
  );
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const { name } of tables) {
    result[name] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM "${name}" ORDER BY rowid`, []);
  }
  return result;
}

describe('migration 5: packing units and category descriptions', () => {
  it('upgrades a v4 database without changing any existing row', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 4));
    const deps = { createId: sequentialIds('v4'), now: () => new Date(T) };

    // v4-era data written with v4-era SQL (current repositories write v5 columns).
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category,
         created_at, updated_at) VALUES ('trip-1', 'Goa', 'Goa', '2026-12-20', '2026-12-24', 1, 0, 'car', 'beach', ?, ?)`,
      [T, T],
    );
    const inventory = createInventoryRepository(db, deps);
    const categories = await db.getAllAsync<{ id: string; name: string; parent_id: string | null }>(
      'SELECT id, name, parent_id FROM inventory_categories',
      [],
    );
    const clothing = categories.find((c) => c.name === 'Clothing')!;
    const tops = categories.find((c) => c.name === 'Tops')!;
    await db.runAsync(
      `INSERT INTO inventory_categories (id, parent_id, name, icon, color, position, cover_image_uri, system_key, created_at, updated_at)
       VALUES ('cat-custom', NULL, 'Camera gear', 'camera-outline', '#6FD6C2', 20, NULL, NULL, ?, ?)`,
      [T, T],
    );
    const shirt = await inventory.createItem(itemInput({ name: 'Linen shirt', quantity: 3, categoryId: clothing.id }));
    await db.runAsync(
      `INSERT INTO trip_luggage (id, trip_id, name, kind, traveller_id, position, created_at, updated_at)
       VALUES ('bag-1', 'trip-1', 'Main suitcase', 'suitcase', NULL, 0, ?, ?)`,
      [T, T],
    );
    const entries: [string, string | null, string, string | null, number, string | null][] = [
      ['e-sub', shirt.id, 'Linen shirt', tops.id, 1, 'bag-1'], // in a subcategory, packed
      ['e-custom', null, 'Lens cloth', 'cat-custom', 0, null],
      ['e-none', null, 'Sandwiches', null, 0, null], // uncategorised one-time item
    ];
    for (const [index, [id, itemId, name, categoryId, packed, bag]] of entries.entries()) {
      await db.runAsync(
        `INSERT INTO packing_entries (id, trip_id, inventory_item_id, name, category_id, quantity, traveller_id, luggage_id,
           is_packed, notes, source, recommendation_id, position, created_at, updated_at)
         VALUES (?, 'trip-1', ?, ?, ?, 2, NULL, ?, ?, 'note', 'manual', NULL, ?, ?, ?)`,
        [id, itemId, name, categoryId, bag, packed, index, T, T],
      );
    }
    await db.runAsync(
      `INSERT INTO inventory_reservations (id, inventory_item_id, trip_id, packing_entry_id, quantity, start_date, end_date,
         status, created_at, updated_at, ended_at)
       VALUES ('res-1', ?, 'trip-1', 'e-sub', 2, '2026-12-20', '2026-12-24', 'active', ?, ?, NULL)`,
      [shirt.id, T, T],
    );
    await db.runAsync(
      `INSERT INTO purchase_items (id, trip_id, trip_name, name, normalized_name, quantity, category_id, status,
         recommendation_id, inventory_item_id, packing_entry_id, notes, created_at, updated_at, purchased_at, resolved_at)
       VALUES ('p-1', 'trip-1', 'Goa', 'Sunscreen', 'sunscreen', 1, NULL, 'needed', NULL, NULL, 'e-none', '', ?, ?, NULL, NULL)`,
      [T, T],
    );
    const before = await snapshot(db);

    const result = await migrate(db, migrations);
    expect(result.applied).toEqual(['packing_units_and_category_descriptions']);
    expect(await getSchemaVersion(db)).toBe(5);

    const after = await snapshot(db);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const table of Object.keys(before)) {
      const added =
        table === 'packing_entries' ? { unit: 'pcs' } : table === 'inventory_categories' ? { description: '' } : {};
      expect({ table, rows: after[table] }).toEqual({ table, rows: before[table]!.map((row) => ({ ...row, ...added })) });
    }

    // The upgraded data reads back through the current repositories.
    const packing = createPackingRepository(db, deps);
    const loaded = await packing.load('trip-1');
    expect(loaded.entries.map((e) => [e.name, e.unit, e.isPacked, e.categoryId])).toEqual([
      ['Linen shirt', 'pcs', true, tops.id],
      ['Lens cloth', 'pcs', false, 'cat-custom'],
      ['Sandwiches', 'pcs', false, null],
    ]);
    expect((await inventory.listCategories()).every((c) => c.description === '')).toBe(true);
    expect((await createTripRepository(db, deps).getById('trip-1'))?.name).toBe('Goa');
    db.close();
  });

  it('upgrades an empty v4 database and supports the new columns', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 4));
    await migrate(db, migrations);
    expect(await getSchemaVersion(db)).toBe(5);
    const deps = { createId: sequentialIds('n'), now: () => new Date(T) };
    const trip = await createTripRepository(db, deps).create(tripInput(), { sections: [] });
    const entry = await createPackingRepository(db, deps).addEntry(trip.id, { name: 'Socks', quantity: 3, unit: 'pairs' });
    expect(entry).toMatchObject({ unit: 'pairs', isPacked: false });
    db.close();
  });
});
