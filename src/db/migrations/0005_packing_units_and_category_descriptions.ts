import type { Migration } from '../migrate';

/**
 * Packing upgrade (two-level packing by category).
 *
 * - `packing_entries.unit`: how a trip entry's quantity is counted
 *   (`pcs`, `pairs`, `sets`, `bottles`, `packs`). Validated in app code so new
 *   units need no migration; existing entries become `pcs`.
 * - `inventory_categories.description`: optional text for a category. The
 *   category tree stays one shared, per-user list for My Inventory and trip
 *   packing; existing categories get an empty description.
 *
 * Additive only: two ADD COLUMNs with constant defaults. No row is rewritten,
 * moved or deleted. Both columns are local-only in the sync registry until a
 * matching cloud migration is approved (before G4).
 */
export const packingUnitsAndCategoryDescriptions: Migration = {
  version: 5,
  name: 'packing_units_and_category_descriptions',
  async up(db) {
    await db.execAsync(`
      ALTER TABLE packing_entries ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs';
      ALTER TABLE inventory_categories ADD COLUMN description TEXT NOT NULL DEFAULT '';
    `);
  },
};
