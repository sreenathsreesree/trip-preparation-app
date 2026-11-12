import type { Migration } from '../migrate';

/**
 * G3 personal cloud backup and restore, device side. New tables only.
 *
 * - `sync_meta`: the Google account this device's data belongs to (set once,
 *   when the user links it), the pull cursor and the last successful sync.
 * - `sync_rows`: for every record known to the cloud, the server revision and a
 *   fingerprint of what was last sent/received. A record is uploaded only when
 *   it changed since, and a downloaded record replaces the device copy only
 *   when the device copy is unchanged since the last sync — otherwise both are
 *   kept and a conflict is recorded (never a silent overwrite).
 * - `sync_conflicts`: the cloud copy of records that changed on both sides.
 * - `drive_cache`: photos restored from the user's Google Drive
 *   ("drive:<file id>" references) downloaded to this device.
 */
export const cloudSync: Migration = {
  version: 11,
  name: 'cloud_sync',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE sync_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sync_rows (
        table_name TEXT NOT NULL,
        pk TEXT NOT NULL,
        revision INTEGER NOT NULL,
        hash TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (table_name, pk)
      );

      CREATE TABLE sync_conflicts (
        table_name TEXT NOT NULL,
        pk TEXT NOT NULL,
        server_data TEXT,
        server_revision INTEGER,
        server_deleted INTEGER NOT NULL DEFAULT 0 CHECK (server_deleted IN (0, 1)),
        detected_at TEXT NOT NULL,
        PRIMARY KEY (table_name, pk)
      );

      CREATE TABLE drive_cache (
        drive_file_id TEXT PRIMARY KEY NOT NULL,
        local_uri TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );
    `);
  },
};
