import type { Migration } from '../migrate';

/**
 * Random RFC 4122 v4 UUID generated inside SQLite, so the data migration needs
 * no JavaScript id factory and stays inside the migration transaction.
 */
const UUID_SQL = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

/** The six standard preparation areas, in display order. */
const STANDARD_SECTIONS = `
  standard(kind, title, ord) AS (
    VALUES ('packing', 'Packing', 0),
           ('documents', 'Documents', 1),
           ('vehicle', 'Vehicle readiness', 2),
           ('tasks', 'Preparation tasks', 3),
           ('shopping', 'Shopping', 4),
           ('home', 'Home departure', 5)
  )`;

/**
 * Trip management and the reusable checklist engine.
 *
 * Schema:
 * - `trip_destinations` / `trip_travellers`: ordered child rows of a trip.
 * - `trips.completed_at` / `trips.archived_at`: explicit, reversible lifecycle.
 * - `checklist_templates`: reusable checklists.
 * - `checklist_sections` / `checklist_tasks`: one structure for both trip
 *   checklists and templates. A section belongs to exactly one trip *or* one
 *   template. Trip tasks are copies, so completion is per trip and template
 *   edits never change existing trips. `source_*` columns record provenance only
 *   (no foreign keys, so deleting a template leaves trips untouched).
 *
 * Kept for compatibility and maintained by the repository in the same
 * transaction: `trips.destination` (first destination) and `trips.adults` /
 * `trips.children` (traveller counts).
 *
 * Data: every existing trip gets its destination, placeholder travellers named
 * from its adult/child counts, its standard sections, and all `prep_items`
 * moved into `checklist_tasks` with ids, completion and order preserved.
 */
export const tripManagementAndChecklists: Migration = {
  version: 2,
  name: 'trip_management_and_checklists',
  async up(db) {
    await db.execAsync(`
      ALTER TABLE trips ADD COLUMN completed_at TEXT;
      ALTER TABLE trips ADD COLUMN archived_at TEXT;

      CREATE TABLE trip_destinations (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_trip_destinations_trip ON trip_destinations (trip_id, position);

      CREATE TABLE trip_travellers (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'adult',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_trip_travellers_trip ON trip_travellers (trip_id, position);

      CREATE TABLE checklist_templates (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE checklist_sections (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT REFERENCES trips (id) ON DELETE CASCADE,
        template_id TEXT REFERENCES checklist_templates (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'custom',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((trip_id IS NULL) <> (template_id IS NULL))
      );
      CREATE INDEX idx_checklist_sections_trip ON checklist_sections (trip_id, position);
      CREATE INDEX idx_checklist_sections_template ON checklist_sections (template_id, position);

      CREATE TABLE checklist_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL REFERENCES checklist_sections (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'recommended',
        is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        source_template_id TEXT,
        source_task_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_checklist_tasks_section ON checklist_tasks (section_id, position);
    `);

    // Destinations: the single legacy destination becomes position 0.
    await db.execAsync(`
      INSERT INTO trip_destinations (id, trip_id, name, position, created_at, updated_at)
      SELECT ${UUID_SQL}, id, destination, 0, created_at, updated_at FROM trips;
    `);

    // Travellers: expand the adult/child counts into editable placeholder rows.
    await db.execAsync(`
      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100)
      INSERT INTO trip_travellers (id, trip_id, name, kind, position, created_at, updated_at)
      SELECT ${UUID_SQL}, t.id, 'Adult ' || seq.n, 'adult', seq.n - 1, t.created_at, t.updated_at
      FROM trips t JOIN seq ON seq.n <= t.adults;

      WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100)
      INSERT INTO trip_travellers (id, trip_id, name, kind, position, created_at, updated_at)
      SELECT ${UUID_SQL}, t.id, 'Child ' || seq.n, 'child', t.adults + seq.n - 1, t.created_at, t.updated_at
      FROM trips t JOIN seq ON seq.n <= t.children;
    `);

    // Sections: the standard areas that applied to each trip (vehicle readiness
    // only for self-driven trips, or where vehicle items already exist).
    await db.execAsync(`
      WITH ${STANDARD_SECTIONS}
      INSERT INTO checklist_sections (id, trip_id, template_id, title, kind, position, created_at, updated_at)
      SELECT ${UUID_SQL}, t.id, NULL, s.title, s.kind, s.ord, t.created_at, t.created_at
      FROM trips t CROSS JOIN standard s
      WHERE s.kind <> 'vehicle'
         OR t.transport_mode IN ('car', 'bike', 'mixed')
         OR EXISTS (SELECT 1 FROM prep_items p WHERE p.trip_id = t.id AND p.section = 'vehicle');
    `);

    // Defensive: any unrecognised legacy section key becomes a custom section.
    await db.execAsync(`
      WITH ${STANDARD_SECTIONS}
      INSERT INTO checklist_sections (id, trip_id, template_id, title, kind, position, created_at, updated_at)
      SELECT ${UUID_SQL}, p.trip_id, NULL, p.section, 'custom', 100, MIN(p.created_at), MIN(p.created_at)
      FROM prep_items p
      WHERE p.section NOT IN (SELECT kind FROM standard)
      GROUP BY p.trip_id, p.section;
    `);

    // Tasks: move every checklist item, keeping id, completion and order.
    await db.execAsync(`
      INSERT INTO checklist_tasks (id, section_id, title, description, notes, priority, is_done,
                                   position, source_template_id, source_task_id, created_at, updated_at)
      SELECT p.id,
             (SELECT s.id FROM checklist_sections s
               WHERE s.trip_id = p.trip_id
                 AND (s.kind = p.section OR (s.kind = 'custom' AND s.title = p.section))
               LIMIT 1),
             p.title, '', '', 'recommended', p.is_done, p.position, NULL, NULL, p.created_at, p.updated_at
      FROM prep_items p;

      DROP TABLE prep_items;
    `);
  },
};
