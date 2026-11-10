/**
 * The minimal database surface the data layer depends on.
 *
 * `expo-sqlite`'s `SQLiteDatabase` satisfies this interface in the app, and
 * tests provide a Node SQLite implementation, so repositories and migrations
 * are exercised against a real SQL engine without a device.
 */
export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
}

export interface Database {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<RunResult>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
