import { openTestDatabase, type TestDatabase } from '../../../test/nodeSqliteDatabase';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

/**
 * Upgrading a device that has real data at v6 (planner upgrade) through the
 * Journey Journal, Drive queue, shared trips and Trip Calculator migrations
 * (v7–v10) must not change a single existing row, and must leave the database
 * consistent. Also guards the rule that migrations are additive.
 */

const T = '2026-11-01T00:00:00Z';

async function snapshot(db: TestDatabase, tables: readonly string[]) {
  const result: Record<string, unknown[]> = {};
  for (const name of tables) result[name] = await db.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid`, []);
  return result;
}

const tableNames = async (db: TestDatabase) =>
  (
    await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
      [],
    )
  ).map((r) => r.name);

describe('upgrading v6 → latest', () => {
  it('keeps every existing row unchanged and the database consistent', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 6));
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category, created_at, updated_at)
       VALUES ('trip-1', 'Kerala', 'Munnar', '2026-11-20', '2026-11-25', 2, 0, 'car', 'leisure', ?, ?)`,
      [T, T],
    );
    await db.runAsync(`INSERT INTO trip_travellers (id, trip_id, name, kind, position, created_at, updated_at) VALUES ('tr-1', 'trip-1', 'Asha', 'adult', 0, ?, ?)`, [T, T]);
    await db.runAsync(
      `INSERT INTO trip_plan_nodes (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
       VALUES ('n-1', 'trip-1', NULL, NULL, NULL, 'planner', 'Munnar', '', 0, ?, ?)`,
      [T, T],
    );
    await db.runAsync(`INSERT INTO trip_route_stops (id, trip_id, node_id, position, created_at) VALUES ('rs-1', 'trip-1', 'n-1', 0, ?)`, [T]);
    await db.runAsync(`INSERT INTO trip_navigation_items (id, trip_id, node_id, parent_id, position, created_at, updated_at) VALUES ('nav-1', 'trip-1', 'n-1', NULL, 0, ?, ?)`, [T, T]);
    await db.runAsync(
      `INSERT INTO plan_node_memories (node_id, trip_id, visited_on, rating, notes, moments, photos, created_at, updated_at)
       VALUES ('n-1', 'trip-1', '2026-11-21', 5, 'Misty', '', '["file:///a.jpg"]', ?, ?)`,
      [T, T],
    );
    await db.runAsync(`INSERT INTO user_preferences (key, value, updated_at) VALUES ('arrival_prompts', '{"enabled":false}', ?)`, [T]);
    const oldTables = await tableNames(db);
    const before = await snapshot(db, oldTables);

    const result = await migrate(db, migrations);
    expect(result.applied).toEqual(['journey_journal', 'drive_photo_uploads', 'shared_trips', 'trip_expenses', 'cloud_sync']);
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await snapshot(db, oldTables)).toEqual(before);
    // Only new tables were added.
    expect((await tableNames(db)).filter((t) => oldTables.includes(t))).toEqual(oldTables);
    expect(await db.getAllAsync('PRAGMA foreign_key_check', [])).toEqual([]);
    expect(await db.getAllAsync('PRAGMA integrity_check', [])).toEqual([{ integrity_check: 'ok' }]);
    db.close();
  });

  it('every migration from v7 on only creates tables and indexes', () => {
    for (const m of migrations.slice(6)) {
      const source = m.up.toString();
      expect([m.name, /\b(DROP\s+(TABLE|INDEX)|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|INSERT\s+INTO)\b/i.test(source)]).toEqual([m.name, false]);
    }
  });
});
