import type { Database } from './types';

export interface Migration {
  /** Target `PRAGMA user_version` after this migration runs. */
  version: number;
  name: string;
  up(db: Database): Promise<void>;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: string[];
}

export class DatabaseNewerThanAppError extends Error {
  constructor(databaseVersion: number, appVersion: number) {
    super(
      `This device's data was saved by a newer version of the app (schema v${databaseVersion}, ` +
        `this build supports v${appVersion}). Update the app to continue.`,
    );
    this.name = 'DatabaseNewerThanAppError';
  }
}

export function assertValidMigrations(list: readonly Migration[]): void {
  list.forEach((migration, index) => {
    const expected = index + 1;
    if (!Number.isInteger(migration.version) || migration.version !== expected) {
      throw new Error(
        `Migration "${migration.name}" has version ${migration.version}; expected ${expected}.`,
      );
    }
  });
}

export async function getSchemaVersion(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  if (row === null) {
    throw new Error('Could not read the database schema version.');
  }
  return row.user_version;
}

/**
 * Brings the database up to the latest schema.
 *
 * Each migration runs in its own transaction together with its
 * `user_version` bump, so a failure rolls back cleanly and leaves the
 * database at the last fully-applied version. Never deletes user data.
 */
export async function migrate(db: Database, list: readonly Migration[]): Promise<MigrationResult> {
  assertValidMigrations(list);

  const fromVersion = await getSchemaVersion(db);
  const latest = list.length;

  if (fromVersion > latest) {
    throw new DatabaseNewerThanAppError(fromVersion, latest);
  }

  const applied: string[] = [];
  for (const migration of list) {
    if (migration.version <= fromVersion) continue;

    await db.withTransactionAsync(async () => {
      await migration.up(db);
      // PRAGMA values cannot be bound; the version is a validated integer.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    applied.push(migration.name);
  }

  return { fromVersion, toVersion: latest, applied };
}
