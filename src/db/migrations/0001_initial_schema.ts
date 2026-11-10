import type { Migration } from '../migrate';

/**
 * Trips and their preparation checklist items.
 *
 * Enumerations (transport mode, category, section) are validated in the
 * domain layer rather than with CHECK constraints so new values can ship
 * without rebuilding tables. Dates are calendar dates (`YYYY-MM-DD`);
 * timestamps are ISO-8601 UTC instants.
 */
export const initialSchema: Migration = {
  version: 1,
  name: 'initial_schema',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE trips (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        adults INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 0),
        children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
        transport_mode TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (end_date >= start_date)
      );

      CREATE INDEX idx_trips_start_date ON trips (start_date);

      CREATE TABLE prep_items (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        section TEXT NOT NULL,
        title TEXT NOT NULL,
        is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_prep_items_trip_section ON prep_items (trip_id, section, position);
    `);
  },
};
