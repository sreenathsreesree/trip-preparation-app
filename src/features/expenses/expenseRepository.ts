import type { Database } from '@/db/types';

import { isCurrency, MoneyError, splitAmount, type Share, type SplitInput, type SplitMethod } from './money';
import { BUILT_IN_CATEGORIES, CUSTOM_PREFIX, type BudgetPlan } from './planning';

type IdFactory = () => string;

export class ExpenseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export type ExpenseScope = 'personal' | 'group';
export type OutboxKind = 'participant' | 'expense' | 'settlement' | 'budget';

export interface Participant {
  id: string;
  tripId: string;
  name: string;
  userId: string | null;
  isMe: boolean;
  position: number;
  archived: boolean;
}

export interface CustomCategory {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  tripId: string;
  scope: ExpenseScope;
  title: string;
  amountMinor: number;
  currency: string;
  category: string;
  categoryName: string;
  spentOn: string;
  paidBy: string | null;
  splitMethod: SplitMethod;
  splits: (Share & { inputValue: number })[];
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementRecord {
  id: string;
  tripId: string;
  fromId: string;
  toId: string;
  amountMinor: number;
  currency: string;
  settledOn: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  participants: Participant[];
  categories: CustomCategory[];
  expenses: Expense[];
  settlements: SettlementRecord[];
  budgets: BudgetPlan[];
  currency: string;
  /** Group records are read-only (viewer or removed member of a shared trip). */
  groupReadOnly: boolean;
}

export interface ExpenseInput {
  scope: ExpenseScope;
  title: string;
  amountMinor: number;
  currency: string;
  category: string;
  spentOn: string;
  paidBy?: string | null;
  splitMethod?: SplitMethod;
  splits?: readonly SplitInput[];
  notes?: string;
}

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

interface ExpenseRow {
  id: string;
  trip_id: string;
  scope: ExpenseScope;
  title: string;
  amount_minor: number;
  currency: string;
  category: string;
  category_name: string;
  spent_on: string;
  paid_by: string | null;
  split_method: SplitMethod;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseRepository {
  workspace(tripId: string): Promise<Workspace>;
  /** Seeds participants from the trip's travellers the first time (the first traveller is "me"). */
  ensureParticipants(tripId: string): Promise<void>;
  addParticipant(tripId: string, name: string, userId?: string | null): Promise<Participant>;
  renameParticipant(id: string, name: string): Promise<void>;
  setMe(tripId: string, participantId: string): Promise<void>;
  /** Archives (kept in history) or reactivates a participant. */
  setArchived(id: string, archived: boolean): Promise<void>;
  addCategory(tripId: string, name: string): Promise<CustomCategory>;
  removeCategory(id: string): Promise<void>;
  setCurrency(tripId: string, currency: string): Promise<void>;
  saveExpense(tripId: string, input: ExpenseInput, id?: string | null, createdBy?: string | null): Promise<Expense>;
  removeExpense(id: string): Promise<{ tripId: string; scope: ExpenseScope } | null>;
  addSettlement(tripId: string, input: { fromId: string; toId: string; amountMinor: number; currency: string; settledOn: string; note?: string }, createdBy?: string | null): Promise<SettlementRecord>;
  removeSettlement(id: string): Promise<string | null>;
  saveBudget(tripId: string, plan: BudgetPlan): Promise<void>;
  /**
   * Queues a record for the shared trip (only in a shared trip the user can edit). Personal expenses
   * are refused unless `withdrawal` (a group expense that became personal or was deleted): the push
   * then removes the shared copy and never sends the personal one.
   */
  enqueue(tripId: string, kind: OutboxKind, recordId: string, options?: { withdrawal?: boolean }): Promise<boolean>;
  enqueueAll(tripId: string): Promise<number>;
  dueOutbox(tripId: string, now: Date): Promise<{ kind: OutboxKind; recordId: string; attempts: number; queuedAt: string }[]>;
  outboxCount(tripId: string): Promise<number>;
  doneOutbox(tripId: string, kind: OutboxKind, recordId: string, queuedBefore: string): Promise<void>;
  retryOutbox(tripId: string, kind: OutboxKind, recordId: string, error: string, next: Date): Promise<void>;
  isQueued(tripId: string, kind: OutboxKind, recordId: string): Promise<boolean>;
  participant(id: string): Promise<Participant | null>;
  expense(id: string): Promise<Expense | null>;
  settlement(id: string): Promise<SettlementRecord | null>;
  budget(tripId: string, currency: string): Promise<(BudgetPlan & { updatedAt: string }) | null>;
  /** Pull: writes a record from the shared trip, unless this device has an unsent change to it. */
  applyRemote(
    tripId: string,
    record:
      | { kind: 'participant'; id: string; name: string; userId: string | null; archived: boolean; updatedAt: string }
      | { kind: 'expense'; expense: Omit<Expense, 'tripId' | 'scope'> }
      | { kind: 'settlement'; settlement: Omit<SettlementRecord, 'tripId'> }
      | { kind: 'budget'; plan: BudgetPlan; updatedAt: string },
  ): Promise<boolean>;
  removeRemote(tripId: string, kind: OutboxKind, id: string): Promise<void>;
}

export function createExpenseRepository(db: Database, deps: { createId: IdFactory; now?: () => Date }): ExpenseRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  const mapParticipant = (r: { id: string; trip_id: string; name: string; user_id: string | null; is_me: number; position: number; archived_at: string | null }): Participant => ({
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    userId: r.user_id,
    isMe: r.is_me === 1,
    position: r.position,
    archived: r.archived_at !== null,
  });

  async function splitsFor(ids: readonly string[]) {
    const map = new Map<string, (Share & { inputValue: number })[]>();
    if (ids.length === 0) return map;
    const rows = await db.getAllAsync<{ expense_id: string; participant_id: string; share_minor: number; input_value: number }>(
      `SELECT s.* FROM expense_splits s JOIN expense_participants p ON p.id = s.participant_id
       WHERE s.expense_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.position, p.created_at`,
      [...ids],
    );
    for (const r of rows) map.set(r.expense_id, [...(map.get(r.expense_id) ?? []), { participantId: r.participant_id, minor: r.share_minor, inputValue: r.input_value }]);
    return map;
  }

  const mapExpense = (r: ExpenseRow, splits: (Share & { inputValue: number })[]): Expense => ({
    id: r.id,
    tripId: r.trip_id,
    scope: r.scope,
    title: r.title,
    amountMinor: r.amount_minor,
    currency: r.currency,
    category: r.category,
    categoryName: r.category_name,
    spentOn: r.spent_on,
    paidBy: r.paid_by,
    splitMethod: r.split_method,
    splits,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const mapSettlement = (r: { id: string; trip_id: string; from_id: string; to_id: string; amount_minor: number; currency: string; settled_on: string; note: string; created_at: string; updated_at: string }): SettlementRecord => ({
    id: r.id,
    tripId: r.trip_id,
    fromId: r.from_id,
    toId: r.to_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    settledOn: r.settled_on,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  async function sharedRole(tripId: string): Promise<string | null> {
    return (await db.getFirstAsync<{ role: string }>('SELECT role FROM shared_spaces WHERE trip_id = ?', [tripId]))?.role ?? null;
  }
  async function groupReadOnly(tripId: string) {
    const role = await sharedRole(tripId);
    return role === 'viewer' || role === 'removed';
  }
  async function assertGroupWritable(tripId: string) {
    if (await groupReadOnly(tripId)) throw new ExpenseError('You can view this shared trip’s expenses but not change them.');
  }
  async function participantsOf(tripId: string) {
    return (await db.getAllAsync<Parameters<typeof mapParticipant>[0]>('SELECT * FROM expense_participants WHERE trip_id = ? ORDER BY position, created_at', [tripId])).map(mapParticipant);
  }
  async function getExpense(id: string) {
    const row = await db.getFirstAsync<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', [id]);
    return row ? mapExpense(row, (await splitsFor([id])).get(id) ?? []) : null;
  }
  async function categoryName(tripId: string, key: string): Promise<string> {
    if (BUILT_IN_CATEGORIES.some((c) => c.key === key)) return '';
    if (!key.startsWith(CUSTOM_PREFIX)) throw new ExpenseError('Choose a category.');
    const row = await db.getFirstAsync<{ name: string }>('SELECT name FROM expense_categories WHERE id = ? AND trip_id = ?', [key.slice(CUSTOM_PREFIX.length), tripId]);
    if (!row) throw new ExpenseError('That category no longer exists.');
    return row.name;
  }
  async function writeSplits(expenseId: string, shares: readonly Share[], inputs: readonly SplitInput[]) {
    await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [expenseId]);
    for (const share of shares) {
      const input = inputs.find((i) => i.participantId === share.participantId)?.value ?? 0;
      await db.runAsync('INSERT INTO expense_splits (expense_id, participant_id, share_minor, input_value) VALUES (?, ?, ?, ?)', [expenseId, share.participantId, share.minor, input]);
    }
  }

  const repo: ExpenseRepository = {
    async workspace(tripId) {
      const [participants, categories, rows, settlements, budgets, settings, readOnly] = await Promise.all([
        participantsOf(tripId),
        db.getAllAsync<CustomCategory>('SELECT id, name FROM expense_categories WHERE trip_id = ? ORDER BY name', [tripId]),
        db.getAllAsync<ExpenseRow>('SELECT * FROM expenses WHERE trip_id = ? ORDER BY spent_on DESC, created_at DESC', [tripId]),
        db.getAllAsync<Parameters<typeof mapSettlement>[0]>('SELECT * FROM expense_settlements WHERE trip_id = ? ORDER BY settled_on DESC, created_at DESC', [tripId]),
        db.getAllAsync<{ currency: string; total_minor: number | null; daily_limit_minor: number | null; lines: string }>('SELECT * FROM expense_budgets WHERE trip_id = ? ORDER BY currency', [tripId]),
        db.getFirstAsync<{ currency: string }>('SELECT currency FROM expense_settings WHERE trip_id = ?', [tripId]),
        groupReadOnly(tripId),
      ]);
      const splits = await splitsFor(rows.map((r) => r.id));
      return {
        participants,
        categories,
        expenses: rows.map((r) => mapExpense(r, splits.get(r.id) ?? [])),
        settlements: settlements.map(mapSettlement),
        budgets: budgets.map((b) => ({ currency: b.currency, totalMinor: b.total_minor, dailyLimitMinor: b.daily_limit_minor, lines: parseLines(b.lines) })),
        currency: settings?.currency ?? 'INR',
        groupReadOnly: readOnly,
      };
    },

    async ensureParticipants(tripId) {
      // Check and seed in one (serialized) transaction so two screens loading at once never seed twice.
      await db.withTransactionAsync(async () => {
        const count = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expense_participants WHERE trip_id = ?', [tripId]))?.n ?? 0;
        if (count > 0) return;
        const travellers = await db.getAllAsync<{ name: string }>('SELECT name FROM trip_travellers WHERE trip_id = ? ORDER BY position', [tripId]);
        const names = travellers.length > 0 ? travellers.map((t) => t.name) : ['Me'];
        const t = stamp();
        for (const [i, name] of names.entries()) {
          await db.runAsync('INSERT INTO expense_participants (id, trip_id, name, is_me, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
            deps.createId(),
            tripId,
            name.trim().slice(0, 60) || 'Traveller',
            i === 0 ? 1 : 0,
            i,
            t,
            t,
          ]);
        }
      });
    },

    async addParticipant(tripId, name, userId = null) {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean || clean.length > 60) throw new ExpenseError('Give the person a name (up to 60 characters).');
      const existing = await participantsOf(tripId);
      if (existing.some((p) => !p.archived && p.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new ExpenseError(`${clean} is already in this trip.`);
      const id = deps.createId();
      const t = stamp();
      await db.runAsync('INSERT INTO expense_participants (id, trip_id, name, user_id, is_me, position, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)', [
        id,
        tripId,
        clean,
        userId,
        existing.length,
        t,
        t,
      ]);
      return (await repo.participant(id)) as Participant;
    },

    async renameParticipant(id, name) {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean || clean.length > 60) throw new ExpenseError('Give the person a name (up to 60 characters).');
      await db.runAsync('UPDATE expense_participants SET name = ?, updated_at = ? WHERE id = ?', [clean, stamp(), id]);
    },

    async setMe(tripId, participantId) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE expense_participants SET is_me = 0 WHERE trip_id = ?', [tripId]);
        await db.runAsync('UPDATE expense_participants SET is_me = 1 WHERE id = ? AND trip_id = ?', [participantId, tripId]);
      });
    },

    async setArchived(id, archived) {
      await db.runAsync('UPDATE expense_participants SET archived_at = ?, updated_at = ? WHERE id = ?', [archived ? stamp() : null, stamp(), id]);
    },

    async addCategory(tripId, name) {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean || clean.length > 40) throw new ExpenseError('Name the category (up to 40 characters).');
      const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM expense_categories WHERE trip_id = ? AND lower(name) = lower(?)', [tripId, clean]);
      if (exists || BUILT_IN_CATEGORIES.some((c) => c.label.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new ExpenseError('That category already exists.');
      const id = deps.createId();
      const t = stamp();
      await db.runAsync('INSERT INTO expense_categories (id, trip_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, tripId, clean, t, t]);
      return { id, name: clean };
    },

    async removeCategory(id) {
      const used = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE category = ?', [`${CUSTOM_PREFIX}${id}`]);
      if ((used?.n ?? 0) > 0) throw new ExpenseError('Expenses use this category. Change them first.');
      await db.runAsync('DELETE FROM expense_categories WHERE id = ?', [id]);
    },

    async setCurrency(tripId, currency) {
      if (!isCurrency(currency)) throw new ExpenseError('Use a 3-letter currency code like INR.');
      await db.runAsync(
        'INSERT INTO expense_settings (trip_id, currency, updated_at) VALUES (?, ?, ?) ON CONFLICT (trip_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at',
        [tripId, currency, stamp()],
      );
    },

    async saveExpense(tripId, input, id = null, createdBy = null) {
      const title = input.title.trim().replace(/\s+/g, ' ');
      if (!title || title.length > 120) throw new ExpenseError('Describe the expense (up to 120 characters).');
      if (!isCurrency(input.currency)) throw new ExpenseError('Use a 3-letter currency code like INR.');
      if (!isIsoDate(input.spentOn)) throw new ExpenseError('Choose a valid date.');
      const existing = id ? await getExpense(id) : null;
      if (id && !existing) throw new ExpenseError('That expense no longer exists.');
      if (existing && existing.tripId !== tripId) throw new ExpenseError('That expense belongs to another trip.');
      if (input.scope === 'group' || existing?.scope === 'group') await assertGroupWritable(tripId);
      const catName = await categoryName(tripId, input.category);
      const method: SplitMethod = input.scope === 'group' ? (input.splitMethod ?? 'equal') : 'equal';

      let shares: Share[] = [];
      if (input.scope === 'group') {
        const people = new Map((await participantsOf(tripId)).map((p) => [p.id, p]));
        if (!input.paidBy || !people.has(input.paidBy)) throw new ExpenseError('Choose who paid.');
        const inputs = input.splits ?? [];
        if (inputs.some((i) => !people.has(i.participantId))) throw new ExpenseError('Someone in the split is not in this trip.');
        try {
          shares = splitAmount(input.amountMinor, method, inputs, input.currency);
        } catch (error) {
          if (error instanceof MoneyError) throw new ExpenseError(error.message);
          throw error;
        }
      } else if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new ExpenseError('The amount must be more than zero.');
      }

      const t = stamp();
      const expenseId = id ?? deps.createId();
      await db.withTransactionAsync(async () => {
        const values = [
          input.scope,
          title,
          input.amountMinor,
          input.currency,
          input.category,
          catName,
          input.spentOn,
          input.scope === 'group' ? (input.paidBy as string) : null,
          method,
          (input.notes ?? '').trim().slice(0, 1000),
        ];
        if (existing) {
          await db.runAsync(
            'UPDATE expenses SET scope = ?, title = ?, amount_minor = ?, currency = ?, category = ?, category_name = ?, spent_on = ?, paid_by = ?, split_method = ?, notes = ?, updated_at = ? WHERE id = ?',
            [...values, t, expenseId],
          );
        } else {
          await db.runAsync(
            `INSERT INTO expenses (scope, title, amount_minor, currency, category, category_name, spent_on, paid_by, split_method, notes, id, trip_id, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...values, expenseId, tripId, createdBy, t, t],
          );
        }
        await writeSplits(expenseId, shares, input.splits ?? []);
      });
      return (await getExpense(expenseId)) as Expense;
    },

    async removeExpense(id) {
      const e = await getExpense(id);
      if (!e) return null;
      if (e.scope === 'group') await assertGroupWritable(e.tripId);
      await db.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
      return { tripId: e.tripId, scope: e.scope };
    },

    async addSettlement(tripId, input, createdBy = null) {
      await assertGroupWritable(tripId);
      const people = new Set((await participantsOf(tripId)).map((p) => p.id));
      if (!people.has(input.fromId) || !people.has(input.toId)) throw new ExpenseError('Choose who paid whom.');
      if (input.fromId === input.toId) throw new ExpenseError('Choose two different people.');
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new ExpenseError('The amount must be more than zero.');
      if (!isCurrency(input.currency)) throw new ExpenseError('Use a 3-letter currency code like INR.');
      if (!isIsoDate(input.settledOn)) throw new ExpenseError('Choose a valid date.');
      const id = deps.createId();
      const t = stamp();
      await db.runAsync(
        `INSERT INTO expense_settlements (id, trip_id, from_id, to_id, amount_minor, currency, settled_on, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tripId, input.fromId, input.toId, input.amountMinor, input.currency, input.settledOn, (input.note ?? '').trim().slice(0, 200), createdBy, t, t],
      );
      return (await repo.settlement(id)) as SettlementRecord;
    },

    async removeSettlement(id) {
      const s = await repo.settlement(id);
      if (!s) return null;
      await assertGroupWritable(s.tripId);
      await db.runAsync('DELETE FROM expense_settlements WHERE id = ?', [id]);
      return s.tripId;
    },

    async saveBudget(tripId, plan) {
      await assertGroupWritable(tripId);
      if (!isCurrency(plan.currency)) throw new ExpenseError('Use a 3-letter currency code like INR.');
      const ok = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);
      if (!ok(plan.totalMinor) || !ok(plan.dailyLimitMinor) || plan.lines.some((l) => !ok(l.plannedMinor))) throw new ExpenseError('Budgets can’t be negative.');
      const lines = plan.lines.filter((l) => l.plannedMinor > 0);
      await db.runAsync(
        `INSERT INTO expense_budgets (trip_id, currency, total_minor, daily_limit_minor, lines, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (trip_id, currency) DO UPDATE SET total_minor = excluded.total_minor, daily_limit_minor = excluded.daily_limit_minor,
           lines = excluded.lines, updated_at = excluded.updated_at`,
        [tripId, plan.currency, plan.totalMinor, plan.dailyLimitMinor, JSON.stringify(lines), stamp()],
      );
    },

    async enqueue(tripId, kind, recordId, options = {}) {
      const role = await sharedRole(tripId);
      if (role !== 'owner' && role !== 'editor') return false;
      if (kind === 'expense' && !options.withdrawal) {
        const scope = (await db.getFirstAsync<{ scope: string }>('SELECT scope FROM expenses WHERE id = ?', [recordId]))?.scope;
        // Personal expenses are never sent; deleted ones only through an explicit withdrawal.
        if (scope !== 'group') return false;
      }
      const t = stamp();
      await db.runAsync(
        `INSERT INTO expense_outbox (trip_id, kind, record_id, queued_at, attempts, next_attempt_at) VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT (trip_id, kind, record_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL`,
        [tripId, kind, recordId, t, t],
      );
      return true;
    },

    async enqueueAll(tripId) {
      let n = 0;
      for (const p of await participantsOf(tripId)) if (await repo.enqueue(tripId, 'participant', p.id)) n += 1;
      for (const r of await db.getAllAsync<{ id: string }>("SELECT id FROM expenses WHERE trip_id = ? AND scope = 'group'", [tripId])) if (await repo.enqueue(tripId, 'expense', r.id)) n += 1;
      for (const r of await db.getAllAsync<{ id: string }>('SELECT id FROM expense_settlements WHERE trip_id = ?', [tripId])) if (await repo.enqueue(tripId, 'settlement', r.id)) n += 1;
      for (const r of await db.getAllAsync<{ currency: string }>('SELECT currency FROM expense_budgets WHERE trip_id = ?', [tripId])) if (await repo.enqueue(tripId, 'budget', r.currency)) n += 1;
      return n;
    },

    async dueOutbox(tripId, at) {
      const rows = await db.getAllAsync<{ kind: OutboxKind; record_id: string; attempts: number; queued_at: string }>(
        `SELECT kind, record_id, attempts, queued_at FROM expense_outbox WHERE trip_id = ? AND next_attempt_at <= ?
         ORDER BY CASE kind WHEN 'participant' THEN 0 WHEN 'expense' THEN 1 WHEN 'settlement' THEN 2 ELSE 3 END, queued_at`,
        [tripId, at.toISOString()],
      );
      return rows.map((r) => ({ kind: r.kind, recordId: r.record_id, attempts: r.attempts, queuedAt: r.queued_at }));
    },

    async outboxCount(tripId) {
      return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expense_outbox WHERE trip_id = ?', [tripId]))?.n ?? 0;
    },

    async doneOutbox(tripId, kind, recordId, queuedBefore) {
      await db.runAsync('DELETE FROM expense_outbox WHERE trip_id = ? AND kind = ? AND record_id = ? AND queued_at <= ?', [tripId, kind, recordId, queuedBefore]);
    },

    async retryOutbox(tripId, kind, recordId, error, next) {
      await db.runAsync('UPDATE expense_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE trip_id = ? AND kind = ? AND record_id = ?', [
        error,
        next.toISOString(),
        tripId,
        kind,
        recordId,
      ]);
    },

    async isQueued(tripId, kind, recordId) {
      return !!(await db.getFirstAsync('SELECT 1 FROM expense_outbox WHERE trip_id = ? AND kind = ? AND record_id = ?', [tripId, kind, recordId]));
    },

    async participant(id) {
      const row = await db.getFirstAsync<Parameters<typeof mapParticipant>[0]>('SELECT * FROM expense_participants WHERE id = ?', [id]);
      return row ? mapParticipant(row) : null;
    },

    expense: getExpense,

    async settlement(id) {
      const row = await db.getFirstAsync<Parameters<typeof mapSettlement>[0]>('SELECT * FROM expense_settlements WHERE id = ?', [id]);
      return row ? mapSettlement(row) : null;
    },

    async budget(tripId, currency) {
      const b = await db.getFirstAsync<{ currency: string; total_minor: number | null; daily_limit_minor: number | null; lines: string; updated_at: string }>(
        'SELECT * FROM expense_budgets WHERE trip_id = ? AND currency = ?',
        [tripId, currency],
      );
      return b ? { currency: b.currency, totalMinor: b.total_minor, dailyLimitMinor: b.daily_limit_minor, lines: parseLines(b.lines), updatedAt: b.updated_at } : null;
    },

    async applyRemote(tripId, record) {
      const kind: OutboxKind = record.kind;
      const id = record.kind === 'participant' ? record.id : record.kind === 'expense' ? record.expense.id : record.kind === 'settlement' ? record.settlement.id : record.plan.currency;
      if (await repo.isQueued(tripId, kind, id)) return false; // an unsent local change wins until it is sent
      await db.withTransactionAsync(async () => {
        if (record.kind === 'participant') {
          const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM expense_participants WHERE id = ?', [record.id]);
          if (existing) {
            await db.runAsync('UPDATE expense_participants SET name = ?, user_id = ?, archived_at = ?, updated_at = ? WHERE id = ?', [
              record.name,
              record.userId,
              record.archived ? record.updatedAt : null,
              record.updatedAt,
              record.id,
            ]);
          } else {
            const position = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expense_participants WHERE trip_id = ?', [tripId]))?.n ?? 0;
            await db.runAsync(
              'INSERT INTO expense_participants (id, trip_id, name, user_id, is_me, position, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
              [record.id, tripId, record.name, record.userId, position, record.archived ? record.updatedAt : null, record.updatedAt, record.updatedAt],
            );
          }
        } else if (record.kind === 'expense') {
          const e = record.expense;
          // A custom category from another member: keep its name so it shows correctly here.
          if (e.category.startsWith(CUSTOM_PREFIX) && e.categoryName) {
            await db.runAsync('INSERT OR IGNORE INTO expense_categories (id, trip_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
              e.category.slice(CUSTOM_PREFIX.length),
              tripId,
              e.categoryName.slice(0, 40),
              e.updatedAt,
              e.updatedAt,
            ]);
          }
          await db.runAsync('DELETE FROM expenses WHERE id = ?', [e.id]);
          await db.runAsync(
            `INSERT INTO expenses (id, trip_id, scope, title, amount_minor, currency, category, category_name, spent_on, paid_by, split_method, notes, created_by, created_at, updated_at)
             VALUES (?, ?, 'group', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, tripId, e.title, e.amountMinor, e.currency, e.category, e.categoryName, e.spentOn, e.paidBy, e.splitMethod, e.notes, e.createdBy, e.createdAt, e.updatedAt],
          );
          for (const s of e.splits) {
            await db.runAsync('INSERT INTO expense_splits (expense_id, participant_id, share_minor, input_value) VALUES (?, ?, ?, ?)', [e.id, s.participantId, s.minor, s.inputValue]);
          }
        } else if (record.kind === 'settlement') {
          const s = record.settlement;
          await db.runAsync(
            `INSERT INTO expense_settlements (id, trip_id, from_id, to_id, amount_minor, currency, settled_on, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET from_id = excluded.from_id, to_id = excluded.to_id, amount_minor = excluded.amount_minor, currency = excluded.currency,
               settled_on = excluded.settled_on, note = excluded.note, updated_at = excluded.updated_at`,
            [s.id, tripId, s.fromId, s.toId, s.amountMinor, s.currency, s.settledOn, s.note, s.createdAt, s.updatedAt],
          );
        } else {
          await db.runAsync(
            `INSERT INTO expense_budgets (trip_id, currency, total_minor, daily_limit_minor, lines, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (trip_id, currency) DO UPDATE SET total_minor = excluded.total_minor, daily_limit_minor = excluded.daily_limit_minor, lines = excluded.lines, updated_at = excluded.updated_at`,
            [tripId, record.plan.currency, record.plan.totalMinor, record.plan.dailyLimitMinor, JSON.stringify(record.plan.lines), record.updatedAt],
          );
        }
      });
      return true;
    },

    async removeRemote(tripId, kind, id) {
      if (await repo.isQueued(tripId, kind, id)) return;
      if (kind === 'expense') await db.runAsync("DELETE FROM expenses WHERE id = ? AND trip_id = ? AND scope = 'group'", [id, tripId]);
      else if (kind === 'settlement') await db.runAsync('DELETE FROM expense_settlements WHERE id = ? AND trip_id = ?', [id, tripId]);
      else if (kind === 'budget') await db.runAsync('DELETE FROM expense_budgets WHERE trip_id = ? AND currency = ?', [tripId, id]);
      else await db.runAsync('UPDATE expense_participants SET archived_at = COALESCE(archived_at, ?) WHERE id = ? AND trip_id = ?', [stamp(), id, tripId]);
    },
  };
  return repo;
}

function parseLines(raw: string): BudgetPlan['lines'] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((l): l is { category: string; plannedMinor: number } => !!l && typeof l.category === 'string' && Number.isSafeInteger(l.plannedMinor))
          .map((l) => ({ category: l.category, plannedMinor: l.plannedMinor }))
      : [];
  } catch {
    return [];
  }
}
