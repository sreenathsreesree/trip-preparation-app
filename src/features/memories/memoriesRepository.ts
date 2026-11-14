import type { Database } from '@/db/types';

export interface MemoryAlbum {
  id: string;
  tripId: string;
  name: string;
  position: number;
  count: number;
  /** First photo, for the album card. */
  coverUri: string | null;
}

export interface PhotoNote {
  caption: string;
  favourite: boolean;
}

export const ALBUM_LIMITS = { nameMax: 60, albumsMax: 50, captionMax: 300 } as const;

export class MemoriesError extends Error {}

/**
 * The user's own Memories albums and per-photo notes for a trip. Albums only
 * reference photos (by the URI the Drive upload queue also tracks): adding,
 * removing or deleting an album never deletes a photo, on the device or in
 * Drive. Everything here stays on this device.
 */
export function createMemoriesRepository(db: Database, deps: { createId: () => string; now?: () => string }) {
  const stamp = () => deps.now?.() ?? new Date().toISOString();
  const cleanName = (name: string) => {
    const value = name.trim();
    if (!value) throw new MemoriesError('Give the album a name.');
    if (value.length > ALBUM_LIMITS.nameMax) throw new MemoriesError(`Keep it under ${ALBUM_LIMITS.nameMax} characters.`);
    return value;
  };

  return {
    async albums(tripId: string): Promise<MemoryAlbum[]> {
      const rows = await db.getAllAsync<{ id: string; trip_id: string; name: string; position: number; n: number; cover: string | null }>(
        `SELECT a.id, a.trip_id, a.name, a.position,
                (SELECT COUNT(*) FROM memory_album_photos p WHERE p.album_id = a.id) AS n,
                (SELECT p.uri FROM memory_album_photos p WHERE p.album_id = a.id ORDER BY p.position, p.added_at LIMIT 1) AS cover
         FROM memory_albums a WHERE a.trip_id = ? ORDER BY a.position, a.created_at`,
        [tripId],
      );
      return rows.map((r) => ({ id: r.id, tripId: r.trip_id, name: r.name, position: r.position, count: r.n, coverUri: r.cover }));
    },

    async createAlbum(tripId: string, name: string): Promise<string> {
      const value = cleanName(name);
      const n = await db.getFirstAsync<{ n: number; p: number | null }>('SELECT COUNT(*) AS n, MAX(position) AS p FROM memory_albums WHERE trip_id = ?', [tripId]);
      if ((n?.n ?? 0) >= ALBUM_LIMITS.albumsMax) throw new MemoriesError('This trip has the most albums it can hold.');
      const id = deps.createId();
      const t = stamp();
      await db.runAsync('INSERT INTO memory_albums (id, trip_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, tripId, value, (n?.p ?? -1) + 1, t, t]);
      return id;
    },

    async renameAlbum(id: string, name: string): Promise<void> {
      await db.runAsync('UPDATE memory_albums SET name = ?, updated_at = ? WHERE id = ?', [cleanName(name), stamp(), id]);
    },

    /** Deletes the album only; its photos stay in Memories (and in Drive). */
    async deleteAlbum(id: string): Promise<void> {
      await db.runAsync('DELETE FROM memory_albums WHERE id = ?', [id]);
    },

    async albumPhotos(albumId: string): Promise<string[]> {
      const rows = await db.getAllAsync<{ uri: string }>('SELECT uri FROM memory_album_photos WHERE album_id = ? ORDER BY position, added_at', [albumId]);
      return rows.map((r) => r.uri);
    },

    /** Adds photos to an album; ones already in it are skipped. Returns how many were added. */
    async addToAlbum(albumId: string, uris: readonly string[]): Promise<number> {
      let added = 0;
      await db.withTransactionAsync(async () => {
        const max = await db.getFirstAsync<{ p: number | null }>('SELECT MAX(position) AS p FROM memory_album_photos WHERE album_id = ?', [albumId]);
        let position = (max?.p ?? -1) + 1;
        for (const uri of uris) {
          const r = await db.runAsync('INSERT OR IGNORE INTO memory_album_photos (album_id, uri, position, added_at) VALUES (?, ?, ?, ?)', [albumId, uri, position, stamp()]);
          if (r.changes > 0) {
            added++;
            position++;
          }
        }
        await db.runAsync('UPDATE memory_albums SET updated_at = ? WHERE id = ?', [stamp(), albumId]);
      });
      return added;
    },

    async removeFromAlbum(albumId: string, uris: readonly string[]): Promise<void> {
      await db.withTransactionAsync(async () => {
        for (const uri of uris) await db.runAsync('DELETE FROM memory_album_photos WHERE album_id = ? AND uri = ?', [albumId, uri]);
      });
    },

    async notes(tripId: string): Promise<Record<string, PhotoNote>> {
      const rows = await db.getAllAsync<{ uri: string; caption: string; favourite: number }>('SELECT uri, caption, favourite FROM memory_photo_notes WHERE trip_id = ?', [tripId]);
      return Object.fromEntries(rows.map((r) => [r.uri, { caption: r.caption, favourite: r.favourite === 1 }]));
    },

    async setNote(tripId: string, uri: string, note: PhotoNote): Promise<void> {
      const caption = note.caption.trim();
      if (caption.length > ALBUM_LIMITS.captionMax) throw new MemoriesError('That caption is too long.');
      await db.runAsync(
        `INSERT INTO memory_photo_notes (trip_id, uri, caption, favourite, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (trip_id, uri) DO UPDATE SET caption = excluded.caption, favourite = excluded.favourite, updated_at = excluded.updated_at`,
        [tripId, uri, caption, note.favourite ? 1 : 0, stamp()],
      );
    },
  };
}

export type MemoriesRepository = ReturnType<typeof createMemoriesRepository>;
