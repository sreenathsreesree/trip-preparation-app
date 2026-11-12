import { openTestDatabase } from '../../../test/nodeSqliteDatabase';
import {
  assertValidMigrations,
  DatabaseNewerThanAppError,
  getSchemaVersion,
  migrate,
  type Migration,
} from '../migrate';
import { migrations } from '../migrations';

describe('migrate', () => {
  it('creates the schema on a fresh database', async () => {
    const db = openTestDatabase();
    const result = await migrate(db, migrations);

    expect(result).toEqual({
      fromVersion: 0,
      toVersion: migrations.length,
      applied: [
        'initial_schema',
        'trip_management_and_checklists',
        'inventory_and_packing',
        'destination_planner',
        'packing_units_and_category_descriptions',
        'destination_companion',
        'journey_journal',
      ],
    });
    expect(await getSchemaVersion(db)).toBe(migrations.length);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.map((t) => t.name)).toEqual([
      'checklist_sections',
      'checklist_tasks',
      'checklist_templates',
      'drive_files',
      'inventory_categories',
      'inventory_items',
      'inventory_reservations',
      'journal_entries',
      'journal_photos',
      'packing_entries',
      'packing_recommendations',
      'places',
      'plan_node_alerts',
      'plan_node_memories',
      'plan_node_notes',
      'plan_node_profiles',
      'plan_node_tasks',
      'purchase_items',
      'trip_destinations',
      'trip_luggage',
      'trip_navigation_items',
      'trip_packing',
      'trip_plan_nodes',
      'trip_route_stops',
      'trip_travellers',
      'trips',
      'user_preferences',
    ]);
    db.close();
  });

  it('is idempotent', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);
    const again = await migrate(db, migrations);
    expect(again.applied).toEqual([]);
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    db.close();
  });

  it('upgrades an older schema without losing rows', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children,
                         transport_mode, category, created_at, updated_at)
       VALUES ('t1', 'Keep me', 'Pune', '2026-12-01', '2026-12-02', 1, 0, 'car', 'leisure', 'x', 'x')`,
      [],
    );

    const addNotes: Migration = {
      version: migrations.length + 1,
      name: 'add_trip_notes',
      up: (conn) => conn.execAsync("ALTER TABLE trips ADD COLUMN notes TEXT NOT NULL DEFAULT ''"),
    };
    const result = await migrate(db, [...migrations, addNotes]);

    expect(result).toEqual({
      fromVersion: migrations.length,
      toVersion: migrations.length + 1,
      applied: ['add_trip_notes'],
    });
    const row = await db.getFirstAsync<{ name: string; notes: string }>(
      'SELECT name, notes FROM trips WHERE id = ?',
      ['t1'],
    );
    expect(row).toEqual({ name: 'Keep me', notes: '' });
    db.close();
  });

  it('rolls back a failing migration and keeps the previous version', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);

    const broken: Migration = {
      version: migrations.length + 1,
      name: 'broken',
      async up(conn) {
        await conn.execAsync('CREATE TABLE half_done (id TEXT)');
        throw new Error('boom');
      },
    };

    await expect(migrate(db, [...migrations, broken])).rejects.toThrow('boom');
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    const leftover = await db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE name = 'half_done'",
      [],
    );
    expect(leftover).toBeNull();
    db.close();
  });

  it('refuses to run against a newer schema', async () => {
    const db = openTestDatabase();
    await db.execAsync(`PRAGMA user_version = ${migrations.length + 1}`);
    await expect(migrate(db, migrations)).rejects.toBeInstanceOf(DatabaseNewerThanAppError);
    db.close();
  });

  it('validates migration numbering', () => {
    const noop = async () => undefined;
    expect(() =>
      assertValidMigrations([
        { version: 1, name: 'a', up: noop },
        { version: 3, name: 'c', up: noop },
      ]),
    ).toThrow(/expected 2/);
  });
});
