import type { Database } from '@/db/types';

/**
 * On-device queue of photos to upload to the user's Google Drive, and their
 * Drive references once uploaded. Holds only references and metadata; the
 * photo bytes are read from the device copy at upload time.
 */

export type UploadSource = 'journal' | 'memory';
export type UploadStatus = 'pending' | 'uploaded' | 'failed';

export interface PhotoUpload {
  id: string;
  accountId: string;
  tripId: string;
  source: UploadSource;
  sourceId: string;
  localUri: string;
  cacheUri: string | null;
  fileName: string;
  driveFileId: string | null;
  status: UploadStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  uploadedAt: string | null;
}

interface Row {
  id: string;
  account_id: string;
  trip_id: string;
  source: UploadSource;
  source_id: string;
  local_uri: string;
  cache_uri: string | null;
  file_name: string;
  drive_file_id: string | null;
  status: UploadStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  uploaded_at: string | null;
}

const map = (r: Row): PhotoUpload => ({
  id: r.id,
  accountId: r.account_id,
  tripId: r.trip_id,
  source: r.source,
  sourceId: r.source_id,
  localUri: r.local_uri,
  cacheUri: r.cache_uri,
  fileName: r.file_name,
  driveFileId: r.drive_file_id,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  nextAttemptAt: r.next_attempt_at,
  createdAt: r.created_at,
  uploadedAt: r.uploaded_at,
});

export interface UploadCounts {
  pending: number;
  failed: number;
  uploaded: number;
}

const AUTO_UPLOAD_KEY = 'drive_auto_upload';

export interface PhotoUploadRepository {
  /** Queues a photo (no-op if this account already has it). */
  enqueue(input: { accountId: string; tripId: string; source: UploadSource; sourceId: string; localUri: string; fileName: string }): Promise<PhotoUpload>;
  due(accountId: string, now: Date): Promise<PhotoUpload[]>;
  markUploaded(id: string, driveFileId: string): Promise<void>;
  markRetry(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Failed and waiting items of this account become due now. Returns how many. */
  retryAll(accountId: string): Promise<number>;
  /** Forgets a photo removed from Trip Prep and returns its Drive-download caches to delete. The Drive original is not touched. */
  removeByUri(uri: string): Promise<string[]>;
  byUris(accountId: string, uris: readonly string[]): Promise<Map<string, PhotoUpload>>;
  /** Any account's uploaded copy of this photo (for display from Drive). */
  findUploaded(uri: string): Promise<PhotoUpload | null>;
  setCache(id: string, cacheUri: string | null): Promise<void>;
  counts(accountId: string): Promise<UploadCounts>;
  uploaded(accountId: string): Promise<PhotoUpload[]>;
  /** Journal and memory photos on this device that this account has not queued yet (picked before Drive was connected). */
  unqueued(accountId: string): Promise<{ tripId: string; source: UploadSource; sourceId: string; localUri: string }[]>;
  tripInfo(tripId: string): Promise<{ id: string; name: string; startDate: string } | null>;
  autoUpload(): Promise<boolean>;
  setAutoUpload(on: boolean): Promise<void>;
}

export function createPhotoUploadRepository(db: Database, deps: { createId: () => string; now?: () => Date }): PhotoUploadRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const get = async (where: string, params: (string | number)[]) => {
    const row = await db.getFirstAsync<Row>(`SELECT * FROM drive_photo_uploads WHERE ${where}`, params);
    return row ? map(row) : null;
  };

  return {
    async enqueue(input) {
      const existing = await get('account_id = ? AND local_uri = ?', [input.accountId, input.localUri]);
      if (existing) return existing;
      const id = deps.createId();
      const t = stamp();
      await db.runAsync(
        `INSERT INTO drive_photo_uploads (id, account_id, trip_id, source, source_id, local_uri, file_name, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        [id, input.accountId, input.tripId, input.source, input.sourceId, input.localUri, input.fileName, t, t, t],
      );
      return (await get('id = ?', [id])) as PhotoUpload;
    },

    async due(accountId, at) {
      const rows = await db.getAllAsync<Row>(
        "SELECT * FROM drive_photo_uploads WHERE account_id = ? AND status = 'pending' AND next_attempt_at <= ? ORDER BY created_at, id",
        [accountId, at.toISOString()],
      );
      return rows.map(map);
    },

    async markUploaded(id, driveFileId) {
      const t = stamp();
      await db.runAsync(
        "UPDATE drive_photo_uploads SET status = 'uploaded', drive_file_id = ?, last_error = NULL, uploaded_at = ?, updated_at = ? WHERE id = ?",
        [driveFileId, t, t, id],
      );
    },

    async markRetry(id, error, next) {
      await db.runAsync(
        "UPDATE drive_photo_uploads SET status = 'pending', attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
        [error, next.toISOString(), stamp(), id],
      );
    },

    async markFailed(id, error) {
      await db.runAsync("UPDATE drive_photo_uploads SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?", [
        error,
        stamp(),
        id,
      ]);
    },

    async retryAll(accountId) {
      const t = stamp();
      const result = await db.runAsync(
        "UPDATE drive_photo_uploads SET status = 'pending', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE account_id = ? AND status IN ('pending', 'failed')",
        [t, t, accountId],
      );
      return result.changes;
    },

    async removeByUri(uri) {
      const caches = await db.getAllAsync<{ cache_uri: string | null }>('SELECT cache_uri FROM drive_photo_uploads WHERE local_uri = ?', [uri]);
      await db.runAsync('DELETE FROM drive_photo_uploads WHERE local_uri = ?', [uri]);
      return caches.map((c) => c.cache_uri).filter((c): c is string => !!c);
    },

    async byUris(accountId, uris) {
      const result = new Map<string, PhotoUpload>();
      if (uris.length === 0) return result;
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM drive_photo_uploads WHERE account_id = ? AND local_uri IN (${uris.map(() => '?').join(',')})`,
        [accountId, ...uris],
      );
      for (const r of rows) result.set(r.local_uri, map(r));
      return result;
    },

    findUploaded: (uri) => get("local_uri = ? AND status = 'uploaded' ORDER BY uploaded_at DESC LIMIT 1", [uri]),

    async setCache(id, cacheUri) {
      await db.runAsync('UPDATE drive_photo_uploads SET cache_uri = ?, updated_at = ? WHERE id = ?', [cacheUri, stamp(), id]);
    },

    async counts(accountId) {
      const rows = await db.getAllAsync<{ status: UploadStatus; n: number }>(
        'SELECT status, COUNT(*) AS n FROM drive_photo_uploads WHERE account_id = ? GROUP BY status',
        [accountId],
      );
      const counts: UploadCounts = { pending: 0, failed: 0, uploaded: 0 };
      for (const r of rows) counts[r.status] = r.n;
      return counts;
    },

    async uploaded(accountId) {
      const rows = await db.getAllAsync<Row>("SELECT * FROM drive_photo_uploads WHERE account_id = ? AND status = 'uploaded' ORDER BY created_at", [accountId]);
      return rows.map(map);
    },

    async unqueued(accountId) {
      const queued = new Set(
        (await db.getAllAsync<{ local_uri: string }>('SELECT local_uri FROM drive_photo_uploads WHERE account_id = ?', [accountId])).map((r) => r.local_uri),
      );
      const result: { tripId: string; source: UploadSource; sourceId: string; localUri: string }[] = [];
      const journal = await db.getAllAsync<{ id: string; uri: string; trip_id: string }>(
        'SELECT p.id, p.uri, e.trip_id FROM journal_photos p JOIN journal_entries e ON e.id = p.entry_id ORDER BY p.created_at',
        [],
      );
      for (const p of journal) if (!queued.has(p.uri)) result.push({ tripId: p.trip_id, source: 'journal', sourceId: p.id, localUri: p.uri });
      const memories = await db.getAllAsync<{ node_id: string; trip_id: string; photos: string }>('SELECT node_id, trip_id, photos FROM plan_node_memories', []);
      for (const m of memories) {
        let photos: unknown = [];
        try {
          photos = JSON.parse(m.photos);
        } catch {
          photos = [];
        }
        for (const uri of Array.isArray(photos) ? photos : []) {
          if (typeof uri === 'string' && !queued.has(uri)) result.push({ tripId: m.trip_id, source: 'memory', sourceId: m.node_id, localUri: uri });
        }
      }
      return result;
    },

    async tripInfo(tripId) {
      const row = await db.getFirstAsync<{ id: string; name: string; start_date: string }>('SELECT id, name, start_date FROM trips WHERE id = ?', [tripId]);
      return row ? { id: row.id, name: row.name, startDate: row.start_date } : null;
    },

    async autoUpload() {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM user_preferences WHERE key = ?', [AUTO_UPLOAD_KEY]);
      return row ? row.value !== 'false' : true;
    },

    async setAutoUpload(on) {
      await db.runAsync(
        'INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        [AUTO_UPLOAD_KEY, on ? 'true' : 'false', stamp()],
      );
    },
  };
}
