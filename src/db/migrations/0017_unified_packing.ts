import type { Migration } from '../migrate';

/**
 * Unified Packing (phase 1). Additive only — no table is changed or dropped.
 *
 * - `packing_entry_meta`: a packing item's priority (essential / recommended /
 *   optional). Packing items had none.
 * - `checklist_task_resolutions`: what the user decided for each task of the old
 *   Packing checklist section ("From your old checklist"): kept in the checklist,
 *   moved to the packing list (with the new item's id), or removed. Prevents a
 *   task from being converted twice.
 *
 * Groups inside a packing category are the category's existing subcategories (no new
 * table). Moving the Clothing organiser's categories into Clothing groups is a data
 * step done by the packing repository (repeat-safe), not here: migrations only create.
 *
 * Both new tables stay on this device (see sync/tables.ts).
 */
export const unifiedPacking: Migration = {
  version: 17,
  name: 'unified_packing',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE packing_entry_meta (
        entry_id TEXT PRIMARY KEY NOT NULL REFERENCES packing_entries (id) ON DELETE CASCADE,
        priority TEXT CHECK (priority IS NULL OR priority IN ('essential', 'recommended', 'optional')),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE checklist_task_resolutions (
        task_id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('kept', 'converted', 'removed')),
        packing_entry_id TEXT,
        decided_at TEXT NOT NULL
      );
      CREATE INDEX idx_task_resolutions_trip ON checklist_task_resolutions (trip_id, decision);
    `);
  },
};
