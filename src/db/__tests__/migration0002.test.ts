import { openTestDatabase, type TestDatabase } from '../../../test/nodeSqliteDatabase';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

const v1Only = migrations.slice(0, 1);

async function seedV1(db: TestDatabase) {
  await migrate(db, v1Only);
  const trip = (id: string, mode: string, adults: number, children: number) =>
    db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children,
                          transport_mode, category, created_at, updated_at)
       VALUES (?, ?, ?, '2026-12-01', '2026-12-05', ?, ?, ?, 'leisure', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [id, `Trip ${id}`, `Place ${id}`, adults, children, mode],
    );
  await trip('car-trip', 'car', 2, 1);
  await trip('train-trip', 'train', 1, 0);
  await trip('empty-trip', 'flight', 3, 2);

  const item = (id: string, tripId: string, section: string, done: number, position: number) =>
    db.runAsync(
      `INSERT INTO prep_items (id, trip_id, section, title, is_done, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')`,
      [id, tripId, section, `Item ${id}`, done, position],
    );
  await item('i1', 'car-trip', 'packing', 1, 0);
  await item('i2', 'car-trip', 'packing', 0, 1);
  await item('i3', 'car-trip', 'vehicle', 1, 0);
  await item('i4', 'train-trip', 'documents', 0, 0);
  await item('i5', 'train-trip', 'legacy-odd', 1, 0);
}

describe('migration 2: trip management and checklists', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = openTestDatabase();
    await seedV1(db);
    const result = await migrate(db, migrations);
    expect(result.applied).toEqual(['trip_management_and_checklists']);
  });

  afterEach(() => db.close());

  it('upgrades to schema v2 and removes the legacy items table', async () => {
    expect(await getSchemaVersion(db)).toBe(2);
    const legacy = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'prep_items'", []);
    expect(legacy).toBeNull();
  });

  it('keeps every trip and adds lifecycle columns as null', async () => {
    const rows = await db.getAllAsync<{ id: string; completed_at: null; archived_at: null }>(
      'SELECT id, completed_at, archived_at FROM trips ORDER BY id',
      [],
    );
    expect(rows).toEqual([
      { id: 'car-trip', completed_at: null, archived_at: null },
      { id: 'empty-trip', completed_at: null, archived_at: null },
      { id: 'train-trip', completed_at: null, archived_at: null },
    ]);
  });

  it('moves each destination into the ordered destinations table', async () => {
    const rows = await db.getAllAsync<{ trip_id: string; name: string; position: number }>(
      'SELECT trip_id, name, position FROM trip_destinations ORDER BY trip_id',
      [],
    );
    expect(rows).toEqual([
      { trip_id: 'car-trip', name: 'Place car-trip', position: 0 },
      { trip_id: 'empty-trip', name: 'Place empty-trip', position: 0 },
      { trip_id: 'train-trip', name: 'Place train-trip', position: 0 },
    ]);
  });

  it('expands traveller counts into named, ordered travellers', async () => {
    const rows = await db.getAllAsync<{ name: string; kind: string; position: number }>(
      "SELECT name, kind, position FROM trip_travellers WHERE trip_id = 'empty-trip' ORDER BY position",
      [],
    );
    expect(rows).toEqual([
      { name: 'Adult 1', kind: 'adult', position: 0 },
      { name: 'Adult 2', kind: 'adult', position: 1 },
      { name: 'Adult 3', kind: 'adult', position: 2 },
      { name: 'Child 1', kind: 'child', position: 3 },
      { name: 'Child 2', kind: 'child', position: 4 },
    ]);
    const ids = await db.getAllAsync<{ id: string }>('SELECT id FROM trip_travellers', []);
    expect(new Set(ids.map((r) => r.id)).size).toBe(ids.length);
    expect(ids.every((r) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.id))).toBe(true);
  });

  it('creates the standard sections each trip had', async () => {
    const kinds = async (tripId: string) =>
      (
        await db.getAllAsync<{ kind: string }>(
          'SELECT kind FROM checklist_sections WHERE trip_id = ? ORDER BY position',
          [tripId],
        )
      ).map((r) => r.kind);

    expect(await kinds('car-trip')).toEqual(['packing', 'documents', 'vehicle', 'tasks', 'shopping', 'home']);
    expect(await kinds('empty-trip')).toEqual(['packing', 'documents', 'tasks', 'shopping', 'home']);
    // Unknown legacy keys are preserved as a custom section rather than dropped.
    expect(await kinds('train-trip')).toEqual(['packing', 'documents', 'tasks', 'shopping', 'home', 'custom']);
  });

  it('moves every item with its id, completion, order and section', async () => {
    const rows = await db.getAllAsync<{
      id: string;
      kind: string;
      title: string;
      is_done: number;
      position: number;
      priority: string;
      trip_id: string;
    }>(
      `SELECT t.id, s.kind, s.trip_id, t.title, t.is_done, t.position, t.priority
       FROM checklist_tasks t JOIN checklist_sections s ON s.id = t.section_id ORDER BY t.id`,
      [],
    );
    expect(rows).toEqual([
      { id: 'i1', kind: 'packing', trip_id: 'car-trip', title: 'Item i1', is_done: 1, position: 0, priority: 'recommended' },
      { id: 'i2', kind: 'packing', trip_id: 'car-trip', title: 'Item i2', is_done: 0, position: 1, priority: 'recommended' },
      { id: 'i3', kind: 'vehicle', trip_id: 'car-trip', title: 'Item i3', is_done: 1, position: 0, priority: 'recommended' },
      { id: 'i4', kind: 'documents', trip_id: 'train-trip', title: 'Item i4', is_done: 0, position: 0, priority: 'recommended' },
      { id: 'i5', kind: 'custom', trip_id: 'train-trip', title: 'Item i5', is_done: 1, position: 0, priority: 'recommended' },
    ]);
  });

  it('cascades trip deletion to all new child tables', async () => {
    await db.execAsync("DELETE FROM trips WHERE id = 'car-trip'");
    for (const table of ['trip_destinations', 'trip_travellers', 'checklist_sections']) {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE trip_id = 'car-trip'`,
        [],
      );
      expect(row?.n).toBe(0);
    }
    const tasks = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM checklist_tasks WHERE id IN ('i1', 'i2', 'i3')",
      [],
    );
    expect(tasks?.n).toBe(0);
  });

  it('rejects a section that belongs to both a trip and a template, or neither', async () => {
    await db.execAsync(
      "INSERT INTO checklist_templates (id, name, created_at, updated_at) VALUES ('tpl', 'T', 'x', 'x')",
    );
    await expect(
      db.execAsync(
        `INSERT INTO checklist_sections (id, trip_id, template_id, title, created_at, updated_at)
         VALUES ('both', 'car-trip', 'tpl', 'Both', 'x', 'x')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execAsync(
        `INSERT INTO checklist_sections (id, trip_id, template_id, title, created_at, updated_at)
         VALUES ('none', NULL, NULL, 'None', 'x', 'x')`,
      ),
    ).rejects.toThrow();
  });
});
