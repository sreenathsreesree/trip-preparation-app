import type { Migration } from '../migrate';

const UUID_SQL = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

/**
 * Destination planner.
 *
 * - `places`: places chosen from a search provider (or entered by hand),
 *   shared by every trip so a saved place is reused, never duplicated.
 *   `provider_place_id` is the provider's stable id (e.g. a Google Place ID)
 *   and is unique per provider. Provider content (coordinates, address,
 *   types, metadata) is a cache with `fetched_at`, refreshed or dropped
 *   according to the provider's caching policy (see features/places/cachePolicy).
 * - `trip_plan_nodes`: each trip's organisational hierarchy (main
 *   destinations, places inside them, places inside those...). `parent_id`
 *   nests nodes; `position` orders siblings. A place appears at most once per
 *   trip. `name` is the user's label and stays usable offline.
 *   `trip_destination_id` links a top-level node to the trip's existing
 *   destination row (`origin = 'trip'`) so trip edits stay in step.
 * - `trip_route_stops`: the separate, explicitly ordered list of stops the
 *   user wants to route through. The hierarchy is never a route by itself.
 * - `trips.planner_opened_at`: drives Home's "continue planning" shortcut.
 *
 * Existing data: every existing trip destination becomes a top-level node and
 * a route stop, in the same order. No existing table is rewritten.
 */
export const destinationPlanner: Migration = {
  version: 4,
  name: 'destination_planner',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE places (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        provider_place_id TEXT,
        name TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        formatted_address TEXT NOT NULL DEFAULT '',
        types TEXT NOT NULL DEFAULT '[]',
        district TEXT,
        state TEXT,
        country TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        fetched_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
        CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180))
      );
      CREATE UNIQUE INDEX idx_places_provider_id
        ON places (provider, provider_place_id)
        WHERE provider_place_id IS NOT NULL;

      CREATE TABLE trip_plan_nodes (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        place_id TEXT REFERENCES places (id) ON DELETE SET NULL,
        trip_destination_id TEXT REFERENCES trip_destinations (id) ON DELETE SET NULL,
        origin TEXT NOT NULL DEFAULT 'planner',
        name TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      );
      CREATE INDEX idx_plan_nodes_tree ON trip_plan_nodes (trip_id, parent_id, position);
      CREATE UNIQUE INDEX idx_plan_nodes_place_once
        ON trip_plan_nodes (trip_id, place_id)
        WHERE place_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_plan_nodes_destination
        ON trip_plan_nodes (trip_destination_id)
        WHERE trip_destination_id IS NOT NULL;

      CREATE TABLE trip_route_stops (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_route_stops_node ON trip_route_stops (trip_id, node_id);
      CREATE INDEX idx_route_stops_order ON trip_route_stops (trip_id, position);

      ALTER TABLE trips ADD COLUMN planner_opened_at TEXT;
    `);

    // Existing destinations become top-level planner nodes and route stops, in order.
    await db.execAsync(`
      INSERT INTO trip_plan_nodes
        (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
      SELECT ${UUID_SQL}, d.trip_id, NULL, NULL, d.id, 'trip', d.name, '', d.position, d.created_at, d.updated_at
      FROM trip_destinations d;

      INSERT INTO trip_route_stops (id, trip_id, node_id, position, created_at)
      SELECT ${UUID_SQL}, n.trip_id, n.id, n.position, n.created_at
      FROM trip_plan_nodes n;
    `);
  },
};
