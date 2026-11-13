import type { Migration } from '../migrate';

/**
 * Group Trip / My Trip, device side. New tables only.
 *
 * - `group_items`: the shared trip's group workspace as cached on this device
 *   (itinerary places, group checklist, shared documents and bookings, group
 *   notes, member readiness). `pending` marks changes still to be sent;
 *   `conflict` holds the other member's version when both changed the same
 *   item, until the user chooses. `remote_updated_at` is the newest cloud
 *   version seen, so a device with a slow clock still writes a newer time.
 * - `my_documents`: this person's private trip documents (IDs, passport,
 *   insurance, medical, own tickets). Never sent to the shared trip.
 * - `route_undo`: the route order before the last optimisation, to restore it.
 */
export const groupWorkspace: Migration = {
  version: 13,
  name: 'group_workspace',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE group_items (
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('place', 'checklist', 'document', 'note', 'readiness')),
        data TEXT NOT NULL DEFAULT '{}',
        author_id TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
        remote_updated_at TEXT,
        conflict TEXT,
        last_error TEXT,
        PRIMARY KEY (trip_id, id)
      );
      CREATE INDEX idx_group_items_kind ON group_items (trip_id, kind);

      CREATE TABLE my_documents (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        doc_date TEXT,
        reference TEXT NOT NULL DEFAULT '',
        link TEXT NOT NULL DEFAULT '',
        expiry TEXT,
        place_name TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_my_documents_trip ON my_documents (trip_id, doc_date);

      CREATE TABLE route_undo (
        trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        stop_order TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
    `);
  },
};
