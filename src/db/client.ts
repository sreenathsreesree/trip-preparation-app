import { openDatabaseAsync } from 'expo-sqlite';
import { Platform } from 'react-native';

import { migrate } from './migrate';
import { migrations } from './migrations';
import { copyDatabase, databaseNameFor, LEGACY_DATABASE_NAME, legacyOwner, partitionFor, type Partition } from './partitions';
import { serializeTransactions } from './serialize';
import type { Database } from './types';

/** @deprecated The pre-partition shared file; kept untouched as a recovery copy after the one-time split. */
export const DATABASE_NAME = LEGACY_DATABASE_NAME;
const MARKER_DATABASE_NAME = 'trip-prep-partitions.db';

async function openRaw(name: string) {
  const db = await openDatabaseAsync(name);
  // Connection settings must be applied outside any transaction.
  if (Platform.OS !== 'web') await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  return db;
}

async function openAndMigrate(name: string): Promise<Database> {
  // One connection per file: queue transactions so quick repeated actions cannot collide.
  const serialized = serializeTransactions(await openRaw(name));
  await migrate(serialized, migrations);
  return serialized;
}

/**
 * One-time split of the pre-partition shared database: its rows are copied
 * (verified, in one transaction) into the partition of the account it was
 * backed up to, or the guest partition if it never was. The old file is only
 * read, never changed or deleted. Done once; recorded in a marker database.
 */
async function splitLegacyDatabase(): Promise<void> {
  const marker = await openDatabaseAsync(MARKER_DATABASE_NAME);
  await marker.execAsync('CREATE TABLE IF NOT EXISTS done (step TEXT PRIMARY KEY, detail TEXT, at TEXT NOT NULL)');
  if (await marker.getFirstAsync('SELECT step FROM done WHERE step = ?', ['legacy_split'])) return;

  const legacyRaw = await openRaw(LEGACY_DATABASE_NAME);
  const version = (await legacyRaw.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ?? 0;
  let detail = 'no previous data';
  if (version > 0) {
    // An older app version may have left it at an earlier schema: bring it up to date first (additive migrations only).
    const legacy = serializeTransactions(legacyRaw);
    await migrate(legacy, migrations);
    const owner = await legacyOwner(legacy);
    // Its own connection: the partition's cached one waits for this split to finish.
    const targetRaw = await openRaw(databaseNameFor(owner));
    const target = serializeTransactions(targetRaw);
    await migrate(target, migrations);
    const copied = await copyDatabase(legacy, target);
    await (targetRaw as { closeAsync?: () => Promise<void> }).closeAsync?.();
    detail = `${owner === 'guest' ? 'guest' : 'account'}: ${Object.values(copied).reduce((a, b) => a + b, 0)} rows`;
  }
  await marker.runAsync('INSERT INTO done (step, detail, at) VALUES (?, ?, ?)', ['legacy_split', detail, new Date().toISOString()]);
}

let splitPromise: Promise<void> | null = null;
const ensureSplit = () => {
  if (!splitPromise) {
    splitPromise = splitLegacyDatabase().catch((error: unknown) => {
      splitPromise = null;
      throw error;
    });
  }
  return splitPromise;
};

const connections = new Map<Partition, Promise<Database>>();

function openPartition(partition: Partition): Promise<Database> {
  let promise = connections.get(partition);
  if (!promise) {
    promise = (async () => {
      await ensureSplit();
      return openAndMigrate(databaseNameFor(partition));
    })().catch((error: unknown) => {
      connections.delete(partition);
      throw error;
    });
    connections.set(partition, promise);
  }
  return promise;
}

let active: Partition = 'guest';
const listeners = new Set<(partition: Partition) => void>();

/** The partition (guest or account) whose data the app shows and changes. */
export const activePartition = () => active;

/**
 * Switches all data access to the guest's or an account's own database. Called
 * by the root layout whenever the signed-in user changes (including offline,
 * from the cached session). Never copies or uploads anything between partitions.
 */
export function setActiveAccount(userId: string | null): Partition {
  const next = partitionFor(userId);
  if (next !== active) {
    active = next;
    for (const listener of listeners) listener(next);
  }
  return next;
}

export function onPartitionChange(listener: (partition: Partition) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns the active partition's database connection, opening and migrating it
 * on first use. A failed open is not cached, so callers can retry.
 */
export function getDatabase(): Promise<Database> {
  return openPartition(active);
}

/** A specific partition's database, for work that must stay with one account even if the user switches meanwhile. */
export function getPartitionDatabase(partition: Partition): Promise<Database> {
  return openPartition(partition);
}
