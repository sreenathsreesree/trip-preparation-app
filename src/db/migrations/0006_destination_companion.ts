import type { Migration } from '../migrate';

/**
 * Destination planner upgrade: the Navigation list and the destination companion.
 *
 * New tables only — `trip_plan_nodes`, `trip_route_stops` and `places` are not
 * altered, so the hierarchy and the route keep their own, independent order.
 *
 * - `trip_navigation_items`: places the user wants to navigate to. A third,
 *   independent structure: its own nesting (`parent_id` between navigation
 *   items) and order. A plan node appears at most once per trip.
 * - `plan_node_profiles`: per-place state and the user's own facts — visit
 *   status (never set without the user), saved flag, cover image, tags, about,
 *   best season, entry fee, travel info, planned visit duration, best time.
 *   One row per node, created on first change.
 * - `plan_node_tasks`: a place's preparation checklist.
 * - `plan_node_notes`: "Notes & my plan", one note per row with a kind.
 * - `plan_node_alerts`: notices the user saved with their source and date.
 * - `plan_node_memories`: the user's own visit record (date, rating, notes,
 *   moments, photos) — separate from any public rating.
 *
 * Everything cascades with its node (and trip). All tables are local-only in
 * the sync registry until a matching cloud migration is separately approved.
 */
export const destinationCompanion: Migration = {
  version: 6,
  name: 'destination_companion',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE trip_navigation_items (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES trip_navigation_items (id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      );
      CREATE UNIQUE INDEX idx_navigation_node ON trip_navigation_items (trip_id, node_id);
      CREATE INDEX idx_navigation_tree ON trip_navigation_items (trip_id, parent_id, position);

      CREATE TABLE plan_node_profiles (
        node_id TEXT PRIMARY KEY NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        visit_status TEXT NOT NULL DEFAULT 'upcoming' CHECK (visit_status IN ('upcoming', 'visited')),
        visited_at TEXT,
        saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
        cover_image_uri TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        about TEXT NOT NULL DEFAULT '',
        best_season TEXT NOT NULL DEFAULT '',
        entry_fee TEXT NOT NULL DEFAULT '',
        travel_info TEXT NOT NULL DEFAULT '',
        visit_minutes INTEGER CHECK (visit_minutes IS NULL OR (visit_minutes BETWEEN 0 AND 10080)),
        best_time TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_node_profiles_trip ON plan_node_profiles (trip_id);

      CREATE TABLE plan_node_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'other',
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_node_tasks_node ON plan_node_tasks (node_id, position);

      CREATE TABLE plan_node_notes (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'other',
        body TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_node_notes_node ON plan_node_notes (node_id, position);

      CREATE TABLE plan_node_alerts (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        source_url TEXT,
        confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'dismissed')),
        observed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_node_alerts_node ON plan_node_alerts (node_id, status);

      CREATE TABLE plan_node_memories (
        node_id TEXT PRIMARY KEY NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        visited_on TEXT,
        rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
        notes TEXT NOT NULL DEFAULT '',
        moments TEXT NOT NULL DEFAULT '',
        photos TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
};
