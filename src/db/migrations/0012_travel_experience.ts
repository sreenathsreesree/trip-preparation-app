import type { Migration } from '../migrate';

/**
 * Travel experience: recommendations, weather, automatic covers and PDF
 * import. New tables only; nothing existing is changed.
 *
 * - `remote_cache`: responses from free public providers (OpenStreetMap
 *   places, Open-Meteo weather), kept so they show offline and so the
 *   providers are not asked twice. Every row has `fetched_at`; screens say
 *   how old it is.
 * - `auto_covers`: the representative image chosen automatically for a trip
 *   or a destination (Wikipedia / Wikimedia Commons), with its licence and
 *   credit, and the device copy once downloaded. A user's own cover photo is
 *   stored where it always was and always wins; this table never replaces it.
 * - `plan_node_days`: the day a destination is planned for (from a PDF
 *   import or set by hand), used for day-wise plans and forecasts. Local
 *   until a matching cloud migration is approved.
 * - `pdf_imports`: an itinerary PDF the user chose (a copy kept on the
 *   device), the text read from it and the editable draft. Nothing reaches
 *   the trip until the user confirms the draft.
 */
export const travelExperience: Migration = {
  version: 12,
  name: 'travel_experience',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE remote_cache (
        key TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX idx_remote_cache_kind ON remote_cache (kind, fetched_at);

      CREATE TABLE auto_covers (
        subject_type TEXT NOT NULL CHECK (subject_type IN ('trip', 'node')),
        subject_id TEXT NOT NULL,
        query TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('found', 'none')),
        image_url TEXT,
        local_uri TEXT,
        title TEXT NOT NULL DEFAULT '',
        credit TEXT NOT NULL DEFAULT '',
        license TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        skipped TEXT NOT NULL DEFAULT '[]',
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (subject_type, subject_id)
      );

      CREATE TABLE plan_node_days (
        node_id TEXT PRIMARY KEY NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        day_date TEXT CHECK (day_date IS NULL OR length(day_date) = 10),
        day_number INTEGER CHECK (day_number IS NULL OR day_number BETWEEN 1 AND 366),
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_plan_node_days_trip ON plan_node_days (trip_id, day_number, day_date);

      CREATE TABLE pdf_imports (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_uri TEXT,
        status TEXT NOT NULL CHECK (status IN ('extracting', 'needs_text', 'draft', 'imported', 'failed')),
        text TEXT NOT NULL DEFAULT '',
        draft TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_pdf_imports_trip ON pdf_imports (trip_id, created_at);
    `);
  },
};
