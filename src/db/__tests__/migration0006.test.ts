import { openTestDatabase, type TestDatabase } from '../../../test/nodeSqliteDatabase';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

const T = '2026-11-01T00:00:00Z';

async function snapshot(db: TestDatabase) {
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
    [],
  );
  const result: Record<string, unknown[]> = {};
  for (const { name } of tables) result[name] = await db.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid`, []);
  return result;
}

describe('migration 6: destination companion', () => {
  it('upgrades a v5 database without changing any existing row', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 5));
    // v5-era data: a trip with a nested plan, a route and a packing entry.
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category, created_at, updated_at)
       VALUES ('trip-1', 'Kerala', 'Munnar', '2026-12-20', '2026-12-24', 1, 0, 'car', 'leisure', ?, ?)`,
      [T, T],
    );
    const nodes: [string, string | null, string, number][] = [
      ['n-munnar', null, 'Munnar', 0],
      ['n-echo', 'n-munnar', 'Echo Point', 0],
      ['n-tea', 'n-munnar', 'Tea Museum', 1],
      ['n-ath', null, 'Athirappilly', 1],
    ];
    for (const [id, parent, name, position] of nodes) {
      await db.runAsync(
        `INSERT INTO trip_plan_nodes (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
         VALUES (?, 'trip-1', ?, NULL, NULL, 'planner', ?, 'note', ?, ?, ?)`,
        [id, parent, name, position, T, T],
      );
    }
    for (const [i, node] of ['n-ath', 'n-echo'].entries()) {
      await db.runAsync('INSERT INTO trip_route_stops (id, trip_id, node_id, position, created_at) VALUES (?, ?, ?, ?, ?)', [
        `s-${i}`,
        'trip-1',
        node,
        i,
        T,
      ]);
    }
    await db.runAsync(
      `INSERT INTO packing_entries (id, trip_id, inventory_item_id, name, category_id, quantity, unit, traveller_id, luggage_id,
         is_packed, notes, source, recommendation_id, position, created_at, updated_at)
       VALUES ('e-1', 'trip-1', NULL, 'Rain jacket', NULL, 1, 'pcs', NULL, NULL, 1, '', 'manual', NULL, 0, ?, ?)`,
      [T, T],
    );
    const before = await snapshot(db);

    const result = await migrate(db, migrations.slice(0, 6));
    expect(result.applied).toEqual(['destination_companion']);
    expect(await getSchemaVersion(db)).toBe(6);

    const after = await snapshot(db);
    const created = [
      'plan_node_alerts',
      'plan_node_memories',
      'plan_node_notes',
      'plan_node_profiles',
      'plan_node_tasks',
      'trip_navigation_items',
    ];
    for (const table of Object.keys(before)) expect({ table, rows: after[table] }).toEqual({ table, rows: before[table] });
    for (const table of created) expect({ table, rows: after[table] }).toEqual({ table, rows: [] });
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), ...created].sort());
    db.close();
  });

  it('cascades companion rows with their place and refuses invalid values', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category, created_at, updated_at)
       VALUES ('t', 'T', '', '2026-12-20', '2026-12-24', 1, 0, 'car', 'leisure', ?, ?)`,
      [T, T],
    );
    await db.runAsync(
      `INSERT INTO trip_plan_nodes (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
       VALUES ('n', 't', NULL, NULL, NULL, 'planner', 'N', '', 0, ?, ?)`,
      [T, T],
    );
    await db.runAsync(`INSERT INTO plan_node_profiles (node_id, trip_id, created_at, updated_at) VALUES ('n', 't', ?, ?)`, [T, T]);
    await db.runAsync(
      `INSERT INTO trip_navigation_items (id, trip_id, node_id, parent_id, position, created_at, updated_at) VALUES ('v', 't', 'n', NULL, 0, ?, ?)`,
      [T, T],
    );
    await expect(
      db.runAsync(`UPDATE plan_node_profiles SET visit_status = 'maybe' WHERE node_id = 'n'`, []),
    ).rejects.toThrow();
    await expect(
      db.runAsync(
        `INSERT INTO trip_navigation_items (id, trip_id, node_id, parent_id, position, created_at, updated_at) VALUES ('v2', 't', 'n', NULL, 1, ?, ?)`,
        [T, T],
      ),
    ).rejects.toThrow(); // a place is in Navigation at most once
    await db.runAsync(`DELETE FROM trip_plan_nodes WHERE id = 'n'`, []);
    expect(await db.getAllAsync('SELECT * FROM plan_node_profiles', [])).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM trip_navigation_items', [])).toEqual([]);
    db.close();
  });
});
