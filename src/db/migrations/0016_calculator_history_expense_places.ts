import type { Migration } from '../migrate';

/**
 * Trip Calculator upgrade. Additive only: two new tables; the existing
 * expense tables are not changed.
 *
 * - `calculator_history`: the quick calculator's past calculations for one
 *   trip. A calculation is never an expense; the user saves one explicitly.
 *   Account isolation comes from the per-account database; the trip id keeps
 *   trips apart.
 * - `expense_places`: an expense's optional location — one of the trip's
 *   existing planner destinations (a main destination or a place inside one).
 *   No row means "Entire trip / no location". There is deliberately no foreign
 *   key to `expenses`: a pulled shared-trip update rewrites the expense row and
 *   must not drop the location; the repository removes the link when the
 *   expense is deleted. Deleting the destination removes only the link.
 *
 * Both stay on this device (see sync/tables.ts).
 */
export const calculatorHistoryExpensePlaces: Migration = {
  version: 16,
  name: 'calculator_history_expense_places',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE calculator_history (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        expression TEXT NOT NULL CHECK (length(expression) BETWEEN 1 AND 200),
        result TEXT NOT NULL CHECK (length(result) BETWEEN 1 AND 40),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_calculator_history_trip ON calculator_history (trip_id, created_at);

      CREATE TABLE expense_places (
        expense_id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        node_id TEXT NOT NULL REFERENCES trip_plan_nodes (id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_expense_places_trip ON expense_places (trip_id, node_id);
    `);
  },
};
