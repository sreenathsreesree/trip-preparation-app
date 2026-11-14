import type { Migration } from '../migrate';

/**
 * Memories gallery, Clothing & Luggage organizer and cover thumbnails.
 * Additive only: new tables; no existing table or row changes.
 *
 * - `auto_cover_thumbs`: a small (330 px) variant of each automatic cover for
 *   cards and route stops, kept on the device for offline use.
 * - `memory_albums` / `memory_album_photos`: the user's own albums in a trip's
 *   Memories. They reference photos by their URI (the same one the Drive upload
 *   queue tracks); removing a photo from an album never deletes the photo.
 * - `memory_photo_notes`: caption and "favourite moment" per Memories photo.
 * - `clothing_categories`: a trip's clothing categories (T-shirts, Shirts, …).
 * - `clothing_items`: which packing entries are clothing and in which category.
 *   The entry itself (name, quantity, notes, packed, bag, inventory link) stays
 *   in `packing_entries`, so packing progress and bags keep working as before.
 *
 * All of these are personal and stay on this device (see sync/tables.ts):
 * they are never part of a shared trip.
 */
export const memoriesClothingCovers: Migration = {
  version: 14,
  name: 'memories_clothing_covers',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE auto_cover_thumbs (
        subject_type TEXT NOT NULL CHECK (subject_type IN ('trip', 'node')),
        subject_id TEXT NOT NULL,
        thumb_url TEXT,
        thumb_local_uri TEXT,
        PRIMARY KEY (subject_type, subject_id)
      );

      CREATE TABLE memory_albums (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_memory_albums_trip ON memory_albums (trip_id, position);

      CREATE TABLE memory_album_photos (
        album_id TEXT NOT NULL REFERENCES memory_albums (id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        PRIMARY KEY (album_id, uri)
      );

      CREATE TABLE memory_photo_notes (
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (trip_id, uri)
      );

      CREATE TABLE clothing_categories (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'tshirt-crew-outline',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_clothing_categories_trip ON clothing_categories (trip_id, position);

      CREATE TABLE clothing_items (
        entry_id TEXT PRIMARY KEY NOT NULL REFERENCES packing_entries (id) ON DELETE CASCADE,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        category_id TEXT REFERENCES clothing_categories (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_clothing_items_trip ON clothing_items (trip_id, category_id);
    `);
  },
};
