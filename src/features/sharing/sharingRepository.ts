import type { Database } from '@/db/types';

import type { SharedMember, SharedRole } from './sharingApi';

export type SpaceRole = SharedRole | 'removed';

export interface SharedSpace {
  tripId: string;
  cloudTripId: string;
  accountId: string;
  role: SpaceRole;
  displayName: string;
  cursor: { txid: string; revision: number };
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SharedEntry {
  cloudTripId: string;
  id: string;
  authorId: string;
  authorName: string;
  entryDate: string;
  title: string;
  body: string;
  mood: string | null;
  placeName: string;
  updatedAt: string;
}

export interface OutboxItem {
  tripId: string;
  entryId: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  queuedAt: string;
}

/** What is sent for a shared entry: text only (photos stay in the author's Drive). */
export interface EntryForPush {
  id: string;
  visibility: 'private' | 'shared';
  entryDate: string;
  title: string;
  body: string;
  mood: string | null;
  placeName: string;
  createdAt: string;
}

interface SpaceRow {
  trip_id: string;
  cloud_trip_id: string;
  account_id: string;
  role: SpaceRole;
  display_name: string;
  pull_txid: string;
  pull_revision: number;
  last_synced_at: string | null;
  last_error: string | null;
}

const mapSpace = (r: SpaceRow): SharedSpace => ({
  tripId: r.trip_id,
  cloudTripId: r.cloud_trip_id,
  accountId: r.account_id,
  role: r.role,
  displayName: r.display_name,
  cursor: { txid: r.pull_txid, revision: r.pull_revision },
  lastSyncedAt: r.last_synced_at,
  lastError: r.last_error,
});

export interface SharingRepository {
  space(tripId: string): Promise<SharedSpace | null>;
  spaceByCloudId(accountId: string, cloudTripId: string): Promise<SharedSpace | null>;
  spaces(accountId: string): Promise<SharedSpace[]>;
  linkSpace(input: { tripId: string; cloudTripId: string; accountId: string; role: SharedRole; displayName: string }): Promise<SharedSpace>;
  setRole(tripId: string, role: SpaceRole): Promise<void>;
  setSynced(tripId: string, cursor: { txid: string; revision: number }, at: string): Promise<void>;
  setError(tripId: string, error: string | null): Promise<void>;
  /** Unlinks the trip from the shared trip: the local trip and its journal stay; cached shared data goes. */
  unlink(tripId: string): Promise<void>;
  saveMembers(cloudTripId: string, members: readonly SharedMember[]): Promise<void>;
  members(cloudTripId: string): Promise<SharedMember[]>;
  /** Queues an entry for the shared trip if its trip is shared. Returns whether it was queued. */
  enqueue(tripId: string, entryId: string): Promise<boolean>;
  /** Queues every entry of the trip (after sharing it, so already-shared entries go up). */
  enqueueAll(tripId: string): Promise<number>;
  dueOutbox(tripId: string, now: Date): Promise<OutboxItem[]>;
  outboxCount(tripId: string): Promise<number>;
  doneOutbox(tripId: string, entryId: string, queuedBefore: string): Promise<void>;
  retryOutbox(tripId: string, entryId: string, error: string, next: Date): Promise<void>;
  entryForPush(entryId: string): Promise<EntryForPush | null>;
  saveSharedEntry(entry: SharedEntry): Promise<void>;
  deleteSharedEntry(cloudTripId: string, id: string): Promise<void>;
  sharedEntries(cloudTripId: string): Promise<SharedEntry[]>;
}

export function createSharingRepository(db: Database, deps: { now?: () => Date } = {}): SharingRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  return {
    async space(tripId) {
      const row = await db.getFirstAsync<SpaceRow>('SELECT * FROM shared_spaces WHERE trip_id = ?', [tripId]);
      return row ? mapSpace(row) : null;
    },
    async spaceByCloudId(accountId, cloudTripId) {
      const row = await db.getFirstAsync<SpaceRow>('SELECT * FROM shared_spaces WHERE account_id = ? AND cloud_trip_id = ?', [accountId, cloudTripId]);
      return row ? mapSpace(row) : null;
    },
    async spaces(accountId) {
      return (await db.getAllAsync<SpaceRow>('SELECT * FROM shared_spaces WHERE account_id = ? ORDER BY created_at', [accountId])).map(mapSpace);
    },
    async linkSpace({ tripId, cloudTripId, accountId, role, displayName }) {
      const t = stamp();
      await db.runAsync(
        `INSERT INTO shared_spaces (trip_id, cloud_trip_id, account_id, role, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (trip_id) DO UPDATE SET cloud_trip_id = excluded.cloud_trip_id, account_id = excluded.account_id,
           role = excluded.role, display_name = excluded.display_name, updated_at = excluded.updated_at`,
        [tripId, cloudTripId, accountId, role, displayName, t, t],
      );
      return (await this.space(tripId)) as SharedSpace;
    },
    async setRole(tripId, role) {
      await db.runAsync('UPDATE shared_spaces SET role = ?, updated_at = ? WHERE trip_id = ?', [role, stamp(), tripId]);
    },
    async setSynced(tripId, cursor, at) {
      await db.runAsync('UPDATE shared_spaces SET pull_txid = ?, pull_revision = ?, last_synced_at = ?, last_error = NULL, updated_at = ? WHERE trip_id = ?', [
        cursor.txid,
        cursor.revision,
        at,
        stamp(),
        tripId,
      ]);
    },
    async setError(tripId, error) {
      await db.runAsync('UPDATE shared_spaces SET last_error = ?, updated_at = ? WHERE trip_id = ?', [error, stamp(), tripId]);
    },
    async unlink(tripId) {
      const space = await this.space(tripId);
      if (!space) return;
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM shared_entries WHERE cloud_trip_id = ?', [space.cloudTripId]);
        await db.runAsync('DELETE FROM shared_members WHERE cloud_trip_id = ?', [space.cloudTripId]);
        await db.runAsync('DELETE FROM shared_outbox WHERE trip_id = ?', [tripId]);
        await db.runAsync("UPDATE journal_entries SET visibility = 'private' WHERE trip_id = ? AND visibility = 'shared'", [tripId]);
        await db.runAsync('DELETE FROM shared_spaces WHERE trip_id = ?', [tripId]);
      });
    },
    async saveMembers(cloudTripId, members) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM shared_members WHERE cloud_trip_id = ?', [cloudTripId]);
        for (const m of members) {
          await db.runAsync('INSERT INTO shared_members (cloud_trip_id, user_id, role, display_name) VALUES (?, ?, ?, ?)', [cloudTripId, m.userId, m.role, m.displayName]);
        }
      });
    },
    async members(cloudTripId) {
      const rows = await db.getAllAsync<{ user_id: string; role: SharedRole; display_name: string }>(
        "SELECT user_id, role, display_name FROM shared_members WHERE cloud_trip_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, display_name",
        [cloudTripId],
      );
      return rows.map((r) => ({ userId: r.user_id, role: r.role, displayName: r.display_name }));
    },
    async enqueue(tripId, entryId) {
      const space = await db.getFirstAsync<{ role: string }>('SELECT role FROM shared_spaces WHERE trip_id = ?', [tripId]);
      if (!space || (space.role !== 'owner' && space.role !== 'editor')) return false;
      const t = stamp();
      await db.runAsync(
        `INSERT INTO shared_outbox (trip_id, entry_id, queued_at, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT (trip_id, entry_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL`,
        [tripId, entryId, t, t],
      );
      return true;
    },
    async enqueueAll(tripId) {
      const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM journal_entries WHERE trip_id = ? AND visibility = 'shared'", [tripId]);
      let n = 0;
      for (const r of rows) if (await this.enqueue(tripId, r.id)) n += 1;
      return n;
    },
    async dueOutbox(tripId, at) {
      const rows = await db.getAllAsync<{ trip_id: string; entry_id: string; attempts: number; next_attempt_at: string; last_error: string | null; queued_at: string }>(
        'SELECT * FROM shared_outbox WHERE trip_id = ? AND next_attempt_at <= ? ORDER BY queued_at',
        [tripId, at.toISOString()],
      );
      return rows.map((r) => ({ tripId: r.trip_id, entryId: r.entry_id, attempts: r.attempts, nextAttemptAt: r.next_attempt_at, lastError: r.last_error, queuedAt: r.queued_at }));
    },
    async outboxCount(tripId) {
      return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM shared_outbox WHERE trip_id = ?', [tripId]))?.n ?? 0;
    },
    async doneOutbox(tripId, entryId, queuedBefore) {
      // Only if not re-queued meanwhile (a newer edit during the push stays queued).
      await db.runAsync('DELETE FROM shared_outbox WHERE trip_id = ? AND entry_id = ? AND queued_at <= ?', [tripId, entryId, queuedBefore]);
    },
    async retryOutbox(tripId, entryId, error, next) {
      await db.runAsync('UPDATE shared_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE trip_id = ? AND entry_id = ?', [
        error,
        next.toISOString(),
        tripId,
        entryId,
      ]);
    },
    async entryForPush(entryId) {
      const row = await db.getFirstAsync<{ id: string; visibility: 'private' | 'shared'; entry_date: string; title: string; body: string; mood: string | null; place: string | null; created_at: string }>(
        `SELECT e.id, e.visibility, e.entry_date, e.title, e.body, e.mood, n.name AS place, e.created_at
         FROM journal_entries e LEFT JOIN trip_plan_nodes n ON n.id = e.node_id WHERE e.id = ?`,
        [entryId],
      );
      return row
        ? { id: row.id, visibility: row.visibility, entryDate: row.entry_date, title: row.title, body: row.body, mood: row.mood, placeName: row.place ?? '', createdAt: row.created_at }
        : null;
    },
    async saveSharedEntry(e) {
      await db.runAsync(
        `INSERT INTO shared_entries (cloud_trip_id, id, author_id, author_name, entry_date, title, body, mood, place_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (cloud_trip_id, id) DO UPDATE SET author_id = excluded.author_id, author_name = excluded.author_name,
           entry_date = excluded.entry_date, title = excluded.title, body = excluded.body, mood = excluded.mood,
           place_name = excluded.place_name, updated_at = excluded.updated_at`,
        [e.cloudTripId, e.id, e.authorId, e.authorName, e.entryDate, e.title, e.body, e.mood, e.placeName, e.updatedAt],
      );
    },
    async deleteSharedEntry(cloudTripId, id) {
      await db.runAsync('DELETE FROM shared_entries WHERE cloud_trip_id = ? AND id = ?', [cloudTripId, id]);
    },
    async sharedEntries(cloudTripId) {
      const rows = await db.getAllAsync<{ cloud_trip_id: string; id: string; author_id: string; author_name: string; entry_date: string; title: string; body: string; mood: string | null; place_name: string; updated_at: string }>(
        'SELECT * FROM shared_entries WHERE cloud_trip_id = ? ORDER BY entry_date DESC, updated_at',
        [cloudTripId],
      );
      return rows.map((r) => ({
        cloudTripId: r.cloud_trip_id,
        id: r.id,
        authorId: r.author_id,
        authorName: r.author_name,
        entryDate: r.entry_date,
        title: r.title,
        body: r.body,
        mood: r.mood,
        placeName: r.place_name,
        updatedAt: r.updated_at,
      }));
    },
  };
}
