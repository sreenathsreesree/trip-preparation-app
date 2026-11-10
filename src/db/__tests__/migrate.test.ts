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

    expect(result).toEqual({ fromVersion: 0, toVersion: 1, applied: ['initial_schema'] });
    expect(await getSchemaVersion(db)).toBe(1);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.map((t) => t.name)).toEqual(['prep_items', 'trips']);
    db.close();
  });

  it('is idempotent', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations);
    const again = await migrate(db, migrations);
    expect(again.applied).toEqual([]);
    expect(await getSchemaVersion(db)).toBe(1);
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
      version: 2,
      name: 'add_trip_notes',
      up: (conn) => conn.execAsync("ALTER TABLE trips ADD COLUMN notes TEXT NOT NULL DEFAULT ''"),
    };
    const result = await migrate(db, [...migrations, addNotes]);

    expect(result).toEqual({ fromVersion: 1, toVersion: 2, applied: ['add_trip_notes'] });
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
      version: 2,
      name: 'broken',
      async up(conn) {
        await conn.execAsync('CREATE TABLE half_done (id TEXT)');
        throw new Error('boom');
      },
    };

    await expect(migrate(db, [...migrations, broken])).rejects.toThrow('boom');
    expect(await getSchemaVersion(db)).toBe(1);
    const leftover = await db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE name = 'half_done'",
      [],
    );
    expect(leftover).toBeNull();
    db.close();
  });

  it('refuses to run against a newer schema', async () => {
    const db = openTestDatabase();
    await db.execAsync('PRAGMA user_version = 5');
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
