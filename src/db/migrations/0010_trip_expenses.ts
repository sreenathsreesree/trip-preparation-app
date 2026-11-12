import type { Migration } from '../migrate';

/**
 * Trip Calculator (Phase M). New tables only.
 *
 * Amounts are INTEGER minor units with a 3-letter currency per row; nothing is
 * ever converted. Two scopes:
 * - personal: the user's own spending — private, never split, never part of
 *   group balances, never sent anywhere;
 * - group: paid by one participant and split between participants; in a
 *   shared trip these (and settlements, participants, the budget) are sent to
 *   the shared trip for members to see according to their role.
 *
 * - `expense_participants`: who can pay and share (seeded from the trip's
 *   travellers; `user_id` links a shared-trip member). Archived, never deleted
 *   once used, so history stays correct.
 * - `expense_categories`: a trip's custom categories (built-ins live in code).
 * - `expenses` + `expense_splits`: the split is stored as exact shares that add
 *   up to the amount, plus the user's input (exact amount, basis points or
 *   share count) for editing.
 * - `expense_settlements`: payments between participants.
 * - `expense_budgets`: per trip and currency: total, daily limit, category lines.
 * - `expense_settings`: the trip's default currency.
 * - `expense_outbox`: shared-trip records waiting to be sent.
 */
export const tripExpenses: Migration = {
  version: 10,
  name: 'trip_expenses',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE expense_participants (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
        user_id TEXT,
        is_me INTEGER NOT NULL DEFAULT 0 CHECK (is_me IN (0, 1)),
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_expense_participants_trip ON expense_participants (trip_id, position);

      CREATE TABLE expense_categories (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('personal', 'group')),
        title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
        category TEXT NOT NULL DEFAULT 'other',
        category_name TEXT NOT NULL DEFAULT '',
        spent_on TEXT NOT NULL CHECK (length(spent_on) = 10),
        paid_by TEXT REFERENCES expense_participants (id),
        split_method TEXT NOT NULL DEFAULT 'equal' CHECK (split_method IN ('equal', 'exact', 'percent', 'shares')),
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((scope = 'personal' AND paid_by IS NULL) OR (scope = 'group' AND paid_by IS NOT NULL))
      );
      CREATE INDEX idx_expenses_trip ON expenses (trip_id, spent_on, created_at);

      CREATE TABLE expense_splits (
        expense_id TEXT NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES expense_participants (id),
        share_minor INTEGER NOT NULL CHECK (share_minor >= 0),
        input_value INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (expense_id, participant_id)
      );

      CREATE TABLE expense_settlements (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        from_id TEXT NOT NULL REFERENCES expense_participants (id),
        to_id TEXT NOT NULL REFERENCES expense_participants (id),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
        settled_on TEXT NOT NULL CHECK (length(settled_on) = 10),
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (from_id <> to_id)
      );
      CREATE INDEX idx_expense_settlements_trip ON expense_settlements (trip_id, settled_on);

      CREATE TABLE expense_budgets (
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
        total_minor INTEGER CHECK (total_minor IS NULL OR total_minor >= 0),
        daily_limit_minor INTEGER CHECK (daily_limit_minor IS NULL OR daily_limit_minor >= 0),
        lines TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (trip_id, currency)
      );

      CREATE TABLE expense_settings (
        trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE expense_outbox (
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('participant', 'expense', 'settlement', 'budget')),
        record_id TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (trip_id, kind, record_id)
      );
    `);
  },
};
