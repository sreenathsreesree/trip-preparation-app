import type { Migration } from '../migrate';

/**
 * Journey Journal (Phase K). New tables only.
 *
 * - `journal_entries`: dated entries per trip, optionally about a destination
 *   (the link is cleared if the destination is removed; the entry stays).
 *   `visibility` is private by default; only entries the user marks shared in
 *   a shared trip ever leave the device (Phase L).
 * - `journal_photos`: the entry's photos (app-owned copies), ordered.
 * - `drive_files`: what is already backed up to the user's own Google Drive
 *   (file id and content hash), so a backup uploads only what changed. Purely
 *   a record of the backup; deleting it never touches the journal.
 *
 * All local-only in the sync registry: the journal is personal, and Google
 * Drive (not Supabase) is its optional backup.
 */
export const journeyJournal: Migration = {
  version: 7,
  name: 'journey_journal',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE journal_entries (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT REFERENCES trip_plan_nodes (id) ON DELETE SET NULL,
        entry_date TEXT NOT NULL CHECK (length(entry_date) = 10),
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        mood TEXT CHECK (mood IS NULL OR mood IN ('great', 'good', 'okay', 'tired', 'bad')),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_journal_trip_date ON journal_entries (trip_id, entry_date, created_at);

      CREATE TABLE journal_photos (
        id TEXT PRIMARY KEY NOT NULL,
        entry_id TEXT NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
        uri TEXT NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_journal_photos_entry ON journal_photos (entry_id, position);

      CREATE TABLE drive_files (
        local_kind TEXT NOT NULL CHECK (local_kind IN ('folder', 'journal', 'photo')),
        local_id TEXT NOT NULL,
        drive_file_id TEXT NOT NULL,
        content_hash TEXT NOT NULL DEFAULT '',
        synced_at TEXT NOT NULL,
        PRIMARY KEY (local_kind, local_id)
      );
    `);
  },
};
