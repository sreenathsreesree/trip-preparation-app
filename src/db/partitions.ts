import type { Database } from './types';

/**
 * Local data is partitioned by account: the guest and every signed-in account
 * have their own SQLite file, so one account's trips can never be shown to,
 * edited by or uploaded for another.
 */
export type Partition = 'guest' | `user:${string}`;

export const LEGACY_DATABASE_NAME = 'trip-prep.db';
export const GUEST_DATABASE_NAME = 'trip-prep-guest.db';

export const partitionFor = (userId: string | null | undefined): Partition => (userId ? `user:${userId}` : 'guest');

export const partitionUserId = (partition: Partition): string | null => (partition === 'guest' ? null : partition.slice('user:'.length));

export function databaseNameFor(partition: Partition): string {
  const userId = partitionUserId(partition);
  if (!userId) return GUEST_DATABASE_NAME;
  const safe = userId.replace(/[^A-Za-z0-9-]/g, '_');
  if (!safe) throw new Error('Invalid account id.');
  return `trip-prep-user-${safe}.db`;
}

/** Which partition the pre-partition shared database belongs to: the account it was backed up to, otherwise the guest. */
export async function legacyOwner(db: Database): Promise<Partition> {
  const table = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_meta'", []);
  if (!table) return 'guest';
  const row = await db.getFirstAsync<{ value: string | null }>("SELECT value FROM sync_meta WHERE key = 'account_id'", []);
  return partitionFor(row?.value ?? null);
}

async function userTables(db: Database): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [],
  );
  return rows.map((r) => r.name);
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function counts(db: Database, tables: readonly string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const t of tables) result[t] = (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(t)}`, []))?.n ?? 0;
  return result;
}

/**
 * Copies every row of `source` into `target`, a freshly created database at
 * the same schema version. The target's own starter rows are replaced so the
 * copy is exact. Runs in one transaction and verifies per-table row counts
 * before committing, so a failure leaves the target as it was. The source is
 * only read.
 */
export async function copyDatabase(source: Database, target: Database): Promise<Record<string, number>> {
  const sourceVersion = (await source.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version;
  const targetVersion = (await target.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version;
  if (sourceVersion !== targetVersion) throw new Error(`Schema versions differ (${sourceVersion} vs ${targetVersion}).`);
  const tables = await userTables(source);
  const targetTables = new Set(await userTables(target));
  const missing = tables.filter((t) => !targetTables.has(t));
  if (missing.length) throw new Error(`Target is missing tables: ${missing.join(', ')}`);
  const expected = await counts(source, tables);

  await target.withTransactionAsync(async () => {
    await target.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of tables) await target.runAsync(`DELETE FROM ${quote(t)}`, []);
    for (const t of tables) {
      const rows = await source.getAllAsync<Record<string, string | number | null>>(`SELECT * FROM ${quote(t)}`, []);
      for (const row of rows) {
        const cols = Object.keys(row);
        await target.runAsync(
          `INSERT INTO ${quote(t)} (${cols.map(quote).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row[c] ?? null),
        );
      }
    }
    const actual = await counts(target, tables);
    const wrong = tables.filter((t) => actual[t] !== expected[t]);
    if (wrong.length) throw new Error(`Copy verification failed for: ${wrong.join(', ')}`);
  });
  return expected;
}
