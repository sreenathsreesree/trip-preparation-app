import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { migrate } from '../../../db/migrate';
import { migrations } from '../../../db/migrations';
import { LOCAL_ONLY_TABLES, SYNC_TABLES } from '../tables';

describe('sync table registry vs the SQLite schema', () => {
  it('accounts for every local table and column (synced or deliberately local-only)', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      [],
    );
    const registered = new Set([...SYNC_TABLES.map((t) => t.name), ...Object.keys(LOCAL_ONLY_TABLES)]);
    expect(tables.map((t) => t.name).filter((name) => !registered.has(name))).toEqual([]);

    for (const table of SYNC_TABLES) {
      const columns = (await db.getAllAsync<{ name: string; pk: number }>(`PRAGMA table_info(${table.name})`, [])).map(
        (c) => c.name,
      );
      const accounted = [...table.columns, ...Object.keys(table.localOnly ?? {})].sort();
      expect({ table: table.name, columns: [...columns].sort() }).toEqual({ table: table.name, columns: accounted });
      expect(table.columns).toContain(table.pk);
    }
    db.close();
  });

  it('orders parents before children', () => {
    const rank = new Map(SYNC_TABLES.map((t) => [t.name, t.rank]));
    const refs: [string, string][] = [
      ['trip_travellers', 'trips'],
      ['checklist_sections', 'trips'],
      ['checklist_sections', 'checklist_templates'],
      ['checklist_tasks', 'checklist_sections'],
      ['inventory_items', 'inventory_categories'],
      ['trip_packing', 'trips'],
      ['trip_plan_nodes', 'places'],
      ['trip_route_stops', 'trip_plan_nodes'],
      ['trip_luggage', 'trip_travellers'],
      ['packing_entries', 'trip_luggage'],
      ['packing_entries', 'inventory_items'],
      ['packing_recommendations', 'packing_entries'],
      ['inventory_reservations', 'packing_entries'],
      ['purchase_items', 'packing_entries'],
    ];
    for (const [child, parent] of refs) {
      expect(`${child}:${(rank.get(child) ?? 0) > (rank.get(parent) ?? 99)}`).toBe(`${child}:true`);
    }
  });
});
