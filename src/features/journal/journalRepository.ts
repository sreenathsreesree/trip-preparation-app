import type { Database } from '@/db/types';

import {
  isMood,
  JOURNAL_LIMITS,
  validateEntry,
  type BackupEntry,
  type BackupPhoto,
  type EntryInput,
  type JournalEntry,
  type JournalPhoto,
  type MemoryItem,
  type Visibility,
} from './model';

type IdFactory = () => string;

export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

interface EntryRow {
  id: string;
  trip_id: string;
  node_id: string | null;
  entry_date: string;
  title: string;
  body: string;
  mood: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
}

interface PhotoRow {
  id: string;
  entry_id: string;
  uri: string;
  caption: string;
  position: number;
  created_at: string;
}

const mapPhoto = (r: PhotoRow): JournalPhoto => ({ id: r.id, entryId: r.entry_id, uri: r.uri, caption: r.caption, position: r.position, createdAt: r.created_at });
const mapEntry = (r: EntryRow, photos: JournalPhoto[]): JournalEntry => ({
  id: r.id,
  tripId: r.trip_id,
  nodeId: r.node_id,
  entryDate: r.entry_date,
  title: r.title,
  body: r.body,
  mood: isMood(r.mood) ? r.mood : null,
  visibility: r.visibility === 'shared' ? 'shared' : 'private',
  photos,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type DriveKind = 'folder' | 'journal' | 'photo';
export interface DriveRecord {
  kind: DriveKind;
  localId: string;
  driveFileId: string;
  contentHash: string;
  syncedAt: string;
}

export interface JournalRepository {
  list(tripId: string): Promise<JournalEntry[]>;
  get(id: string): Promise<JournalEntry | null>;
  create(tripId: string, input: EntryInput): Promise<JournalEntry>;
  update(id: string, input: EntryInput): Promise<JournalEntry>;
  setVisibility(id: string, visibility: Visibility): Promise<JournalEntry>;
  /** Removes the entry; returns its photo URIs so the caller can delete the files. */
  remove(id: string): Promise<string[]>;
  addPhoto(entryId: string, uri: string, caption?: string): Promise<JournalPhoto>;
  setCaption(photoId: string, caption: string): Promise<void>;
  /** Returns the removed photo's URI. */
  removePhoto(photoId: string): Promise<string | null>;
  /** Destination memories with a visit date, for the timeline. */
  memories(tripId: string): Promise<MemoryItem[]>;
  /** Restore: adds entries / photos from a backup (never overwrites). `photoUri` maps a backup photo to its local copy. */
  importEntries(
    tripId: string,
    entries: readonly BackupEntry[],
    photos: readonly { entryId: string; photo: BackupPhoto; uri: string }[],
  ): Promise<{ entries: number; photos: number }>;
  driveRecord(kind: DriveKind, localId: string): Promise<DriveRecord | null>;
  saveDriveRecord(record: Omit<DriveRecord, 'syncedAt'>): Promise<void>;
}

export function createJournalRepository(db: Database, deps: { createId: IdFactory; now?: () => Date }): JournalRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function photosFor(entryIds: readonly string[]): Promise<Map<string, JournalPhoto[]>> {
    const map = new Map<string, JournalPhoto[]>();
    if (entryIds.length === 0) return map;
    const rows = await db.getAllAsync<PhotoRow>(
      `SELECT * FROM journal_photos WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY position, created_at`,
      [...entryIds],
    );
    for (const row of rows) map.set(row.entry_id, [...(map.get(row.entry_id) ?? []), mapPhoto(row)]);
    return map;
  }

  async function get(id: string): Promise<JournalEntry | null> {
    const row = await db.getFirstAsync<EntryRow>('SELECT * FROM journal_entries WHERE id = ?', [id]);
    if (!row) return null;
    return mapEntry(row, (await photosFor([id])).get(id) ?? []);
  }

  async function must(id: string): Promise<JournalEntry> {
    const entry = await get(id);
    if (!entry) throw new JournalError('That journal entry no longer exists.');
    return entry;
  }

  async function checkNode(tripId: string, nodeId: string | null | undefined) {
    if (!nodeId) return null;
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM trip_plan_nodes WHERE id = ? AND trip_id = ?', [nodeId, tripId]);
    if (!row) throw new JournalError('That place is no longer in this trip.');
    return nodeId;
  }

  function clean(input: EntryInput) {
    const error = validateEntry(input);
    if (error) throw new JournalError(error);
    return { title: input.title?.trim() ?? '', body: input.body?.trim() ?? '', mood: input.mood ?? null };
  }

  return {
    async list(tripId) {
      const rows = await db.getAllAsync<EntryRow>('SELECT * FROM journal_entries WHERE trip_id = ? ORDER BY entry_date DESC, created_at', [tripId]);
      const photos = await photosFor(rows.map((r) => r.id));
      return rows.map((r) => mapEntry(r, photos.get(r.id) ?? []));
    },

    get,

    async create(tripId, input) {
      const trip = await db.getFirstAsync<{ id: string }>('SELECT id FROM trips WHERE id = ?', [tripId]);
      if (!trip) throw new JournalError('That trip no longer exists.');
      const { title, body, mood } = clean(input);
      const nodeId = await checkNode(tripId, input.nodeId);
      const id = deps.createId();
      const t = stamp();
      await db.runAsync(
        `INSERT INTO journal_entries (id, trip_id, node_id, entry_date, title, body, mood, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
        [id, tripId, nodeId, input.entryDate, title, body, mood, t, t],
      );
      return must(id);
    },

    async update(id, input) {
      const entry = await must(id);
      const { title, body, mood } = clean(input);
      const nodeId = await checkNode(entry.tripId, input.nodeId);
      await db.runAsync(
        'UPDATE journal_entries SET entry_date = ?, title = ?, body = ?, mood = ?, node_id = ?, updated_at = ? WHERE id = ?',
        [input.entryDate, title, body, mood, nodeId, stamp(), id],
      );
      return must(id);
    },

    async setVisibility(id, visibility) {
      await must(id);
      if (visibility !== 'private' && visibility !== 'shared') throw new JournalError('Choose private or shared.');
      await db.runAsync('UPDATE journal_entries SET visibility = ?, updated_at = ? WHERE id = ?', [visibility, stamp(), id]);
      return must(id);
    },

    async remove(id) {
      const entry = await get(id);
      if (!entry) return [];
      await db.runAsync('DELETE FROM journal_entries WHERE id = ?', [id]);
      return entry.photos.map((p) => p.uri);
    },

    async addPhoto(entryId, uri, caption = '') {
      const entry = await must(entryId);
      if (entry.photos.length >= JOURNAL_LIMITS.photosMax) throw new JournalError(`An entry can hold up to ${JOURNAL_LIMITS.photosMax} photos.`);
      const id = deps.createId();
      const t = stamp();
      const position = entry.photos.reduce((max, p) => Math.max(max, p.position + 1), 0);
      await db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO journal_photos (id, entry_id, uri, caption, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          id,
          entryId,
          uri,
          caption.trim().slice(0, JOURNAL_LIMITS.captionMax),
          position,
          t,
        ]);
        await db.runAsync('UPDATE journal_entries SET updated_at = ? WHERE id = ?', [t, entryId]);
      });
      return { id, entryId, uri, caption: caption.trim(), position, createdAt: t };
    },

    async setCaption(photoId, caption) {
      const clean = caption.trim();
      if (clean.length > JOURNAL_LIMITS.captionMax) throw new JournalError(`Keep captions under ${JOURNAL_LIMITS.captionMax} characters.`);
      await db.runAsync('UPDATE journal_photos SET caption = ? WHERE id = ?', [clean, photoId]);
    },

    async removePhoto(photoId) {
      const row = await db.getFirstAsync<PhotoRow>('SELECT * FROM journal_photos WHERE id = ?', [photoId]);
      if (!row) return null;
      await db.runAsync('DELETE FROM journal_photos WHERE id = ?', [photoId]);
      await db.runAsync('UPDATE journal_entries SET updated_at = ? WHERE id = ?', [stamp(), row.entry_id]);
      return row.uri;
    },

    async memories(tripId) {
      const rows = await db.getAllAsync<{ node_id: string; name: string; visited_on: string | null; rating: number | null; notes: string; moments: string; photos: string }>(
        `SELECT m.node_id, n.name, m.visited_on, m.rating, m.notes, m.moments, m.photos
         FROM plan_node_memories m JOIN trip_plan_nodes n ON n.id = m.node_id
         WHERE m.trip_id = ? AND m.visited_on IS NOT NULL`,
        [tripId],
      );
      return rows.map((r) => {
        let photos: string[] = [];
        try {
          const parsed: unknown = JSON.parse(r.photos);
          photos = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
        } catch {
          photos = [];
        }
        return { nodeId: r.node_id, nodeName: r.name, visitedOn: r.visited_on as string, rating: r.rating, notes: [r.notes, r.moments].filter(Boolean).join('\n\n'), photos };
      });
    },

    async importEntries(tripId, entries, photos) {
      let addedEntries = 0;
      let addedPhotos = 0;
      await db.withTransactionAsync(async () => {
        for (const e of entries) {
          const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM journal_entries WHERE id = ?', [e.id]);
          if (exists) continue;
          const node = e.nodeId ? await db.getFirstAsync<{ id: string }>('SELECT id FROM trip_plan_nodes WHERE id = ? AND trip_id = ?', [e.nodeId, tripId]) : null;
          const t = stamp();
          await db.runAsync(
            `INSERT INTO journal_entries (id, trip_id, node_id, entry_date, title, body, mood, visibility, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
            [e.id, tripId, node?.id ?? null, e.entryDate, e.title, e.body, e.mood, e.createdAt || t, e.updatedAt || t],
          );
          addedEntries += 1;
        }
        for (const { entryId, photo, uri } of photos) {
          const entry = await db.getFirstAsync<{ id: string }>('SELECT id FROM journal_entries WHERE id = ? AND trip_id = ?', [entryId, tripId]);
          const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM journal_photos WHERE id = ?', [photo.id]);
          if (!entry || exists) continue;
          await db.runAsync('INSERT INTO journal_photos (id, entry_id, uri, caption, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
            photo.id,
            entryId,
            uri,
            photo.caption,
            photo.position,
            stamp(),
          ]);
          addedPhotos += 1;
        }
      });
      return { entries: addedEntries, photos: addedPhotos };
    },

    async driveRecord(kind, localId) {
      const row = await db.getFirstAsync<{ local_kind: DriveKind; local_id: string; drive_file_id: string; content_hash: string; synced_at: string }>(
        'SELECT * FROM drive_files WHERE local_kind = ? AND local_id = ?',
        [kind, localId],
      );
      return row ? { kind: row.local_kind, localId: row.local_id, driveFileId: row.drive_file_id, contentHash: row.content_hash, syncedAt: row.synced_at } : null;
    },

    async saveDriveRecord(record) {
      await db.runAsync(
        `INSERT INTO drive_files (local_kind, local_id, drive_file_id, content_hash, synced_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (local_kind, local_id) DO UPDATE SET drive_file_id = excluded.drive_file_id, content_hash = excluded.content_hash, synced_at = excluded.synced_at`,
        [record.kind, record.localId, record.driveFileId, record.contentHash, stamp()],
      );
    },
  };
}
