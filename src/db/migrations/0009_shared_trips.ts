import type { Migration } from '../migrate';

/**
 * Shared trips (Phase L), device side. New tables only.
 *
 * - `shared_spaces`: a local trip linked to a cloud shared trip, for one
 *   signed-in account: role, pull cursor, sync status.
 * - `shared_members`: the members list as last seen (for offline display).
 * - `shared_outbox`: journal entries whose shared copy must be updated. At
 *   push time the entry is read again: shared → upload it; private or deleted
 *   → withdraw the shared copy. Private entries never leave the device.
 * - `shared_entries`: other members' shared entries, pulled for offline reading.
 */
export const sharedTrips: Migration = {
  version: 9,
  name: 'shared_trips',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE shared_spaces (
        trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        cloud_trip_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer', 'removed')),
        display_name TEXT NOT NULL DEFAULT '',
        pull_txid TEXT NOT NULL DEFAULT '0',
        pull_revision INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_shared_spaces_cloud ON shared_spaces (account_id, cloud_trip_id);

      CREATE TABLE shared_members (
        cloud_trip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (cloud_trip_id, user_id)
      );

      CREATE TABLE shared_outbox (
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        entry_id TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (trip_id, entry_id)
      );

      CREATE TABLE shared_entries (
        cloud_trip_id TEXT NOT NULL,
        id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL DEFAULT '',
        entry_date TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        mood TEXT,
        place_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (cloud_trip_id, id)
      );
    `);
  },
};
