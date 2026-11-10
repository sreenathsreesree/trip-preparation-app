import { openDatabaseAsync } from 'expo-sqlite';
import { Platform } from 'react-native';

import { migrate } from './migrate';
import { migrations } from './migrations';
import type { Database } from './types';

export const DATABASE_NAME = 'trip-prep.db';

let databasePromise: Promise<Database> | null = null;

async function openAndMigrate(): Promise<Database> {
  const db = await openDatabaseAsync(DATABASE_NAME);

  // Connection settings must be applied outside any transaction.
  if (Platform.OS !== 'web') {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await migrate(db, migrations);
  return db;
}

/**
 * Returns the app's single shared database connection, opening and migrating
 * it on first use. A failed open is not cached, so callers can retry.
 */
export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = openAndMigrate().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}
