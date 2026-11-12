import type { Database } from '@/db/types';

import { contentHash } from '../journal/drive/driveBackup';
import { syncTripDestinations } from '../planner/plannerRepository';
import { adaptersFor, loadPhotoRefs, type Adapter, type CloudRow } from './adapters';
import { PENDING_SYNC_TABLES, SYNC_TABLES } from './tables';

/**
 * G3 personal backup and restore, using the G1 sync protocol.
 *
 * One run = download, then upload:
 * - Download pages every change since the last cursor and applies it in one
 *   transaction (parents before children; foreign keys checked at commit). A
 *   cloud change replaces a device record only if the device record has not
 *   changed since the last sync; otherwise the device copy is kept and the
 *   cloud copy is saved as a conflict for the user to decide.
 * - Upload sends every record that changed since it was last sent (with the
 *   server revision it was based on), and deletions as tombstones. Results are
 *   recorded per batch, so an interrupted upload resumes; the server treats a
 *   repeated identical change as already applied.
 *
 * This is backup + restore that runs automatically, not real-time sync: two
 * devices editing the same record produce a conflict, resolved by the user.
 */

export interface PullRow {
  table: string;
  pk: string;
  revision: number;
  deleted: boolean;
  data: CloudRow;
}

export interface PushChange {
  table: string;
  pk: string;
  op: 'upsert' | 'delete';
  base_revision: number | null;
  data: CloudRow;
}

export interface PushResult {
  table: string;
  pk: string;
  status: 'applied' | 'conflict' | 'rejected';
  revision?: number | null;
  server_row?: CloudRow;
  reason?: string;
}

export interface SyncApi {
  /** Tables the server can sync (G1, plus G3 once its migration is deployed). */
  tables(): Promise<string[]>;
  push(changes: PushChange[]): Promise<PushResult[]>;
  pull(cursor: { txid: string; revision: number }, limit: number): Promise<{ rows: PullRow[]; has_more: boolean; cursor: { txid: string; revision: number } }>;
}

export class SyncAccountError extends Error {
  constructor(
    readonly kind: 'not_linked' | 'other_account',
    message: string,
  ) {
    super(message);
    this.name = 'SyncAccountError';
  }
}

export const isSyncAccountError = (e: unknown): e is SyncAccountError => e instanceof SyncAccountError;

export interface SyncResult {
  downloaded: number;
  uploaded: number;
  deletedUp: number;
  conflicts: number;
  rejected: { table: string; pk: string; reason: string }[];
  /** Photos on this device not yet in Google Drive (their records are sent without them). */
  photosNotInDrive: number;
  /** Changes still waiting after this run (0 = everything is backed up). */
  pending: number;
  /** Tables the server does not have yet (G3 migration not deployed). */
  unsupportedTables: string[];
}

const BATCH = 200;

/* ------------------------------------------------------------------ */
/* Device state                                                        */
/* ------------------------------------------------------------------ */

export async function getMeta(db: Database, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
}

async function setMeta(db: Database, key: string, value: string, now: () => Date) {
  await db.runAsync(
    'INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, now().toISOString()],
  );
}

export const linkedAccount = (db: Database) => getMeta(db, 'account_id');

/** Links this device's data to an account (once; never changed silently). */
export async function linkAccount(db: Database, accountId: string, now: () => Date = () => new Date()) {
  const current = await linkedAccount(db);
  if (current && current !== accountId) throw new SyncAccountError('other_account', 'This phone’s trips already belong to another Google account.');
  if (!current) await setMeta(db, 'account_id', accountId, now);
}

/** What is on this device that the user would want to keep (for the adoption question). */
export async function deviceDataSummary(db: Database) {
  const n = async (sql: string) => (await db.getFirstAsync<{ n: number }>(sql, []))?.n ?? 0;
  return {
    trips: await n('SELECT COUNT(*) AS n FROM trips'),
    journalEntries: await n('SELECT COUNT(*) AS n FROM journal_entries'),
    expenses: await n('SELECT COUNT(*) AS n FROM expenses'),
    inventoryItems: await n('SELECT COUNT(*) AS n FROM inventory_items'),
  };
}

const stable = (row: CloudRow, columns: readonly string[]) => JSON.stringify(columns.map((c) => [c, row[c] ?? null]));
const hashRow = (row: CloudRow, columns: readonly string[]) => contentHash(stable(row, columns));

interface Known {
  revision: number;
  hash: string;
}

async function knownRows(db: Database, table: string): Promise<Map<string, Known>> {
  const rows = await db.getAllAsync<{ pk: string; revision: number; hash: string }>('SELECT pk, revision, hash FROM sync_rows WHERE table_name = ?', [table]);
  return new Map(rows.map((r) => [r.pk, { revision: r.revision, hash: r.hash }]));
}

async function markSynced(db: Database, table: string, pk: string, revision: number, hash: string, now: () => Date) {
  await db.runAsync(
    `INSERT INTO sync_rows (table_name, pk, revision, hash, synced_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (table_name, pk) DO UPDATE SET revision = excluded.revision, hash = excluded.hash, synced_at = excluded.synced_at`,
    [table, pk, revision, hash, now().toISOString()],
  );
}

async function recordConflict(db: Database, table: string, pk: string, server: CloudRow | null, revision: number | null, deleted: boolean, now: () => Date) {
  await db.runAsync(
    `INSERT INTO sync_conflicts (table_name, pk, server_data, server_revision, server_deleted, detected_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (table_name, pk) DO UPDATE SET server_data = excluded.server_data, server_revision = excluded.server_revision,
       server_deleted = excluded.server_deleted, detected_at = excluded.detected_at`,
    [table, pk, server ? JSON.stringify(server) : null, revision, deleted ? 1 : 0, now().toISOString()],
  );
}

/* ------------------------------------------------------------------ */
/* Adopting the server's ids for records both devices created alike    */
/* ------------------------------------------------------------------ */

/** Renames a record's id and every foreign key pointing at it (inside a deferred-FK transaction). */
async function remapId(db: Database, table: string, from: string, to: string) {
  await db.runAsync(`UPDATE ${table} SET id = ? WHERE id = ?`, [to, from]);
  const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", []);
  for (const { name } of tables) {
    for (const fk of await db.getAllAsync<{ table: string; from: string }>(`PRAGMA foreign_key_list(${name})`, [])) {
      if (fk.table === table) await db.runAsync(`UPDATE ${name} SET ${fk.from} = ? WHERE ${fk.from} = ?`, [to, from]);
    }
  }
}

/**
 * A fresh install seeds its own starter categories (random ids). When the
 * account's categories arrive, matching never-synced device records take the
 * server id instead of becoming duplicates. Same for saved places (by Place ID).
 */
async function adoptServerIds(db: Database, adapter: Adapter, rows: PullRow[], local: Map<string, CloudRow>, known: Map<string, Known>): Promise<Set<string>> {
  const adopted = new Set<string>();
  const table = adapter.table.name;
  if (table !== 'inventory_categories' && table !== 'places') return adopted;
  const unsynced = () => [...local.values()].filter((r) => !known.has(String(r.id)));
  const ordered = table === 'inventory_categories' ? [...rows].sort((a, b) => (a.data.parent_id ? 1 : 0) - (b.data.parent_id ? 1 : 0)) : rows;
  for (const row of ordered) {
    if (row.deleted || local.has(row.pk) || known.has(row.pk)) continue;
    const d = row.data;
    const match = unsynced().find((r) =>
      table === 'places'
        ? d.provider_place_id != null && r.provider === d.provider && r.provider_place_id === d.provider_place_id
        : d.system_key != null
          ? r.system_key === d.system_key
          : r.system_key == null && r.parent_id === d.parent_id && r.name === d.name,
    );
    if (!match) continue;
    const oldId = String(match.id);
    await remapId(db, table, oldId, row.pk);
    // Children (subcategories) now point at the new id too.
    for (const r of local.values()) if (r.parent_id === oldId) r.parent_id = row.pk;
    local.delete(oldId);
    local.set(row.pk, { ...match, id: row.pk });
    adopted.add(row.pk);
  }
  return adopted;
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

async function download(db: Database, api: SyncApi, adapters: Adapter[], deps: { now: () => Date; createId: () => string }): Promise<number> {
  const startTxid = (await getMeta(db, 'pull_txid')) ?? '0';
  const startRevision = Number((await getMeta(db, 'pull_revision')) ?? '0');
  let cursor = { txid: startTxid, revision: startRevision };
  const rows: PullRow[] = [];
  for (;;) {
    const page = await api.pull(cursor, 500);
    rows.push(...page.rows);
    cursor = page.cursor;
    if (!page.has_more) break;
  }
  if (rows.length === 0) return 0;

  const ctx = await loadPhotoRefs(db);
  const trips = new Set<string>();
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const adapter of adapters) {
      const table = adapter.table;
      const mine = rows.filter((r) => r.table === table.name);
      if (mine.length === 0) continue;
      const local = await adapter.read(db, ctx);
      const known = await knownRows(db, table.name);
      // Records this device created alike (starter categories, places) take the cloud's id and version.
      const adopted = await adoptServerIds(db, adapter, mine, local, known);
      for (const row of mine) {
        const k = known.get(row.pk);
        const localRow = local.get(row.pk);
        const localHash = localRow ? hashRow(localRow, table.columns) : null;
        if (row.deleted) {
          if (!localRow) await db.runAsync('DELETE FROM sync_rows WHERE table_name = ? AND pk = ?', [table.name, row.pk]);
          else if (k && localHash === k.hash) {
            await adapter.remove(db, row.pk);
            await db.runAsync('DELETE FROM sync_rows WHERE table_name = ? AND pk = ?', [table.name, row.pk]);
          } else await recordConflict(db, table.name, row.pk, null, row.revision, true, deps.now);
          continue;
        }
        const serverHash = hashRow(row.data, table.columns);
        if (!localRow) {
          if (k && k.revision !== row.revision) await recordConflict(db, table.name, row.pk, row.data, row.revision, false, deps.now); // deleted here, changed there
          else if (!k) {
            await adapter.write(db, row.data, ctx);
            await markSynced(db, table.name, row.pk, row.revision, serverHash, deps.now);
          }
        } else if (localHash === serverHash) {
          await markSynced(db, table.name, row.pk, row.revision, serverHash, deps.now);
        } else if (adopted.has(row.pk) || (k && localHash === k.hash)) {
          await adapter.write(db, row.data, ctx);
          await markSynced(db, table.name, row.pk, row.revision, serverHash, deps.now);
        } else if (k && serverHash === k.hash) {
          // The cloud holds what this device last sent; the newer device edit is uploaded next.
          await markSynced(db, table.name, row.pk, row.revision, k.hash, deps.now);
        } else {
          await recordConflict(db, table.name, row.pk, row.data, row.revision, false, deps.now);
        }
        if (row.data.trip_id && (table.name === 'trip_plan_nodes' || table.name === 'trips')) trips.add(String(row.data.trip_id));
        if (table.name === 'trips') trips.add(row.pk);
      }
    }
    // Main destinations are derived on each device from the plan.
    for (const tripId of trips) {
      if (await db.getFirstAsync('SELECT 1 FROM trips WHERE id = ?', [tripId])) await syncTripDestinations(db, deps.createId, tripId, deps.now().toISOString());
    }
    await setMeta(db, 'pull_txid', cursor.txid, deps.now);
    await setMeta(db, 'pull_revision', String(cursor.revision), deps.now);
  });
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

async function pendingChanges(db: Database, adapters: Adapter[]): Promise<{ changes: (PushChange & { hash: string })[]; photosNotInDrive: number }> {
  const ctx = await loadPhotoRefs(db);
  const conflicts = new Set(
    (await db.getAllAsync<{ table_name: string; pk: string }>('SELECT table_name, pk FROM sync_conflicts', [])).map((c) => `${c.table_name}/${c.pk}`),
  );
  const changes: (PushChange & { hash: string })[] = [];
  const deletes: (PushChange & { hash: string })[] = [];
  for (const adapter of adapters) {
    const table = adapter.table;
    const local = await adapter.read(db, ctx);
    const known = await knownRows(db, table.name);
    for (const [pk, row] of local) {
      if (conflicts.has(`${table.name}/${pk}`)) continue;
      const hash = hashRow(row, table.columns);
      const k = known.get(pk);
      if (!k || k.hash !== hash) changes.push({ table: table.name, pk, op: 'upsert', base_revision: k?.revision ?? null, data: row, hash });
    }
    for (const [pk, k] of known) {
      if (!local.has(pk) && !conflicts.has(`${table.name}/${pk}`)) deletes.push({ table: table.name, pk, op: 'delete', base_revision: k.revision, data: {}, hash: '' });
    }
  }
  // Children are deleted before their parents.
  return { changes: [...changes, ...deletes.reverse()], photosNotInDrive: ctx.notInDrive.size };
}

async function upload(db: Database, api: SyncApi, adapters: Adapter[], deps: { now: () => Date }) {
  const { changes } = await pendingChanges(db, adapters);
  const out = { uploaded: 0, deletedUp: 0, rejected: [] as SyncResult['rejected'] };
  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    const results = await api.push(batch.map(({ hash: _h, ...c }) => c));
    await db.withTransactionAsync(async () => {
      for (const [index, change] of batch.entries()) {
        const r = results[index];
        if (!r) continue;
        if (r.status === 'applied') {
          if (change.op === 'delete') {
            await db.runAsync('DELETE FROM sync_rows WHERE table_name = ? AND pk = ?', [change.table, change.pk]);
            out.deletedUp += 1;
          } else {
            await markSynced(db, change.table, change.pk, Number(r.revision ?? 0), change.hash, deps.now);
            out.uploaded += 1;
          }
        } else if (r.status === 'conflict') {
          await recordConflict(db, change.table, change.pk, r.server_row ?? null, r.revision ?? null, !r.server_row, deps.now);
        } else {
          out.rejected.push({ table: change.table, pk: change.pk, reason: r.reason ?? 'rejected' });
        }
      }
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

export async function runSync(db: Database, api: SyncApi, deps: { accountId: string; now?: () => Date; createId: () => string }): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const linked = await linkedAccount(db);
  if (!linked) throw new SyncAccountError('not_linked', 'Choose whether to back up this phone’s trips to your account first.');
  if (linked !== deps.accountId) throw new SyncAccountError('other_account', 'This phone’s trips belong to a different Google account. Sign in with that account to sync.');

  const serverTables = new Set(await api.tables());
  // A table the server no longer has (e.g. a rolled-back migration): forget what was sent to it,
  // so everything is uploaded again if it comes back. Device data itself is never touched.
  const known = await db.getAllAsync<{ table_name: string }>('SELECT DISTINCT table_name FROM sync_rows', []);
  for (const { table_name } of known) {
    if (!serverTables.has(table_name)) await db.runAsync('DELETE FROM sync_rows WHERE table_name = ?', [table_name]);
  }
  const adapters = adaptersFor(serverTables);
  const downloaded = await download(db, api, adapters, { now, createId: deps.createId });
  const up = await upload(db, api, adapters, { now });
  const after = await pendingChanges(db, adapters);
  await setMeta(db, 'last_sync_at', now().toISOString(), now);
  const conflicts = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_conflicts', []))?.n ?? 0;
  return {
    downloaded,
    uploaded: up.uploaded,
    deletedUp: up.deletedUp,
    conflicts,
    rejected: up.rejected,
    photosNotInDrive: after.photosNotInDrive,
    pending: after.changes.length,
    unsupportedTables: [...SYNC_TABLES, ...PENDING_SYNC_TABLES].map((t) => t.name).filter((n) => !serverTables.has(n)),
  };
}

/** Counts what is not yet backed up, without contacting the server. */
export async function backupStatus(db: Database, serverTables: readonly string[]) {
  const adapters = adaptersFor(new Set(serverTables));
  const { changes, photosNotInDrive } = await pendingChanges(db, adapters);
  const conflicts = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_conflicts', []))?.n ?? 0;
  return { pending: changes.length, photosNotInDrive, conflicts, lastSyncAt: await getMeta(db, 'last_sync_at') };
}

/** Resolves every conflict one way: keep this device's versions (sent next) or take the cloud's. */
export async function resolveConflicts(db: Database, choice: 'keep_device' | 'use_cloud', deps: { now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  const conflicts = await db.getAllAsync<{ table_name: string; pk: string; server_data: string | null; server_revision: number | null; server_deleted: number }>(
    'SELECT * FROM sync_conflicts',
    [],
  );
  const adapters = adaptersFor(new Set(conflicts.map((c) => c.table_name)));
  const ctx = await loadPhotoRefs(db);
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const c of conflicts) {
      const adapter = adapters.find((a) => a.table.name === c.table_name);
      if (!adapter) continue;
      if (choice === 'keep_device') {
        // Base the next upload on the cloud revision so it replaces the cloud copy.
        if (c.server_revision !== null) await markSynced(db, c.table_name, c.pk, c.server_revision, 'resolved-keep-device', now);
      } else if (c.server_deleted) {
        await adapter.remove(db, c.pk);
        await db.runAsync('DELETE FROM sync_rows WHERE table_name = ? AND pk = ?', [c.table_name, c.pk]);
      } else if (c.server_data) {
        const row = JSON.parse(c.server_data) as CloudRow;
        await adapter.write(db, row, ctx);
        await markSynced(db, c.table_name, c.pk, c.server_revision ?? 0, hashRow(row, adapter.table.columns), now);
      }
      await db.runAsync('DELETE FROM sync_conflicts WHERE table_name = ? AND pk = ?', [c.table_name, c.pk]);
    }
  });
  return conflicts.length;
}

