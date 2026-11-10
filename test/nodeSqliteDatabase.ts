import type { Database, SqlValue } from '@/db/types';

/**
 * Test-only `Database` implementation backed by Node's built-in SQLite.
 *
 * Loaded through `process.getBuiltinModule` so Jest's module registry is
 * bypassed. Gives repositories and migrations a real SQL engine in tests.
 */
interface StatementSync {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

type DatabaseSyncCtor = new (path: string) => DatabaseSync;

function loadDatabaseSync(): DatabaseSyncCtor {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule;
  if (!getBuiltin) {
    throw new Error('Tests require Node 22.3+ (process.getBuiltinModule and node:sqlite).');
  }
  return (getBuiltin('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
}

/** Converts null-prototype rows into plain objects for Jest equality checks. */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

export interface TestDatabase extends Database {
  close(): void;
}

export function openTestDatabase(path = ':memory:'): TestDatabase {
  const DatabaseSyncClass = loadDatabaseSync();
  const db = new DatabaseSyncClass(path);
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params) {
      const result = db.prepare(source).run(...params);
      return { changes: Number(result.changes) };
    },
    async getFirstAsync<T>(source: string, params: SqlValue[]) {
      const row = db.prepare(source).get(...params);
      return row === undefined ? null : plain<T>(row);
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) {
      return db.prepare(source).all(...params).map((row) => plain<T>(row));
    },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}

/** Deterministic id factory: "id-1", "id-2", … */
export function sequentialIds(prefix = 'id'): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}
