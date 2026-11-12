import type { SharedRecordTable, SharingApi } from '../sharing/sharingApi';
import type { ExpenseRepository, OutboxKind } from './expenseRepository';
import { SPLIT_METHODS, type SplitMethod } from './money';

/**
 * Group records of a shared trip ↔ the shared-trip cloud tables.
 * Personal expenses are never read here: the outbox refuses them, and a push
 * of an expense that is no longer a group expense only withdraws the shared copy.
 */

const TABLE: Record<OutboxKind, SharedRecordTable> = {
  participant: 'shared_expense_participants',
  expense: 'shared_expenses',
  settlement: 'shared_expense_settlements',
  budget: 'shared_expense_budgets',
};
const KIND: Record<SharedRecordTable, OutboxKind> = {
  shared_expense_participants: 'participant',
  shared_expenses: 'expense',
  shared_expense_settlements: 'settlement',
  shared_expense_budgets: 'budget',
};
export const isExpenseTable = (table: string): table is SharedRecordTable => table in KIND;

export const RETRY_MIN = [1, 2, 5, 15, 30] as const;

/** Sends queued group records. Throws on the first transport error (the rest stay queued). */
export async function pushExpenses(
  tripId: string,
  cloudTripId: string,
  deps: { api: SharingApi; repo: ExpenseRepository; accountId: string; now: () => Date },
): Promise<{ sent: number; withdrawn: number }> {
  const result = { sent: 0, withdrawn: 0 };
  for (const item of await deps.repo.dueOutbox(tripId, deps.now())) {
    const at = deps.now().toISOString();
    try {
      const row = await rowFor(tripId, cloudTripId, item.kind, item.recordId, deps, at);
      if (row) {
        await deps.api.upsertRecord(TABLE[item.kind], row);
        result.sent += 1;
      } else {
        await deps.api.withdrawRecord(TABLE[item.kind], cloudTripId, item.recordId, at);
        result.withdrawn += 1;
      }
      await deps.repo.doneOutbox(tripId, item.kind, item.recordId, item.queuedAt);
    } catch (error) {
      const stale = typeof error === 'object' && error !== null && 'kind' in error && (error as { kind: string }).kind === 'stale';
      if (stale) {
        await deps.repo.doneOutbox(tripId, item.kind, item.recordId, item.queuedAt);
        continue;
      }
      const minutes = RETRY_MIN[Math.min(item.attempts, RETRY_MIN.length - 1)] as number;
      await deps.repo.retryOutbox(tripId, item.kind, item.recordId, error instanceof Error ? error.message : 'Send failed.', new Date(deps.now().getTime() + minutes * 60_000));
      throw error;
    }
  }
  return result;
}

async function rowFor(
  tripId: string,
  cloud: string,
  kind: OutboxKind,
  id: string,
  deps: { repo: ExpenseRepository; accountId: string },
  at: string,
): Promise<(Record<string, unknown> & { trip_id: string; id: string }) | null> {
  if (kind === 'participant') {
    const p = await deps.repo.participant(id);
    if (!p || p.tripId !== tripId) return null;
    // "Me" on this device is linked to this account for the other members.
    const userId = p.userId ?? (p.isMe ? deps.accountId : null);
    return { trip_id: cloud, id: p.id, name: p.name, user_id: userId, archived: p.archived, created_at: at, updated_at: at, deleted_at: null };
  }
  if (kind === 'expense') {
    const e = await deps.repo.expense(id);
    if (!e || e.tripId !== tripId || e.scope !== 'group' || !e.paidBy) return null; // personal or deleted: withdraw only
    return {
      trip_id: cloud,
      id: e.id,
      title: e.title,
      amount_minor: e.amountMinor,
      currency: e.currency,
      category: e.category,
      category_name: e.categoryName,
      spent_on: e.spentOn,
      paid_by: e.paidBy,
      split_method: e.splitMethod,
      splits: e.splits.map((s) => ({ participant_id: s.participantId, share_minor: s.minor, input_value: s.inputValue })),
      notes: e.notes,
      created_at: e.createdAt,
      updated_at: at,
      deleted_at: null,
    };
  }
  if (kind === 'settlement') {
    const s = await deps.repo.settlement(id);
    if (!s || s.tripId !== tripId) return null;
    return {
      trip_id: cloud,
      id: s.id,
      from_id: s.fromId,
      to_id: s.toId,
      amount_minor: s.amountMinor,
      currency: s.currency,
      settled_on: s.settledOn,
      note: s.note,
      created_at: s.createdAt,
      updated_at: at,
      deleted_at: null,
    };
  }
  const b = await deps.repo.budget(tripId, id);
  if (!b) return null;
  return {
    trip_id: cloud,
    id: b.currency,
    total_minor: b.totalMinor,
    daily_limit_minor: b.dailyLimitMinor,
    lines: b.lines,
    created_at: b.updatedAt,
    updated_at: at,
    deleted_at: null,
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : num(v));

/** Applies one pulled row of an expense table to the device. */
export async function applyExpenseRow(
  tripId: string,
  row: { table: string; pk: string; deleted: boolean; data: Record<string, unknown> },
  deps: { repo: ExpenseRepository; accountId: string },
): Promise<void> {
  if (!isExpenseTable(row.table)) return;
  const kind = KIND[row.table];
  if (row.deleted) {
    await deps.repo.removeRemote(tripId, kind, row.pk);
    return;
  }
  const d = row.data;
  const updatedAt = str(d.updated_at);
  if (kind === 'participant') {
    const userId = d.user_id ? str(d.user_id) : null;
    await deps.repo.applyRemote(tripId, { kind, id: row.pk, name: str(d.name), userId, archived: d.archived === true, updatedAt });
    if (userId === deps.accountId) await deps.repo.setMe(tripId, row.pk);
  } else if (kind === 'expense') {
    const splits = Array.isArray(d.splits) ? (d.splits as Record<string, unknown>[]) : [];
    const method = str(d.split_method);
    await deps.repo.applyRemote(tripId, {
      kind,
      expense: {
        id: row.pk,
        title: str(d.title),
        amountMinor: num(d.amount_minor),
        currency: str(d.currency),
        category: str(d.category) || 'other',
        categoryName: str(d.category_name),
        spentOn: str(d.spent_on).slice(0, 10),
        paidBy: str(d.paid_by),
        splitMethod: (SPLIT_METHODS as readonly string[]).includes(method) ? (method as SplitMethod) : 'equal',
        splits: splits.map((s) => ({ participantId: str(s.participant_id), minor: num(s.share_minor), inputValue: num(s.input_value ?? 0) })),
        notes: str(d.notes),
        createdBy: d.created_by ? str(d.created_by) : null,
        createdAt: str(d.created_at),
        updatedAt,
      },
    });
  } else if (kind === 'settlement') {
    await deps.repo.applyRemote(tripId, {
      kind,
      settlement: {
        id: row.pk,
        fromId: str(d.from_id),
        toId: str(d.to_id),
        amountMinor: num(d.amount_minor),
        currency: str(d.currency),
        settledOn: str(d.settled_on).slice(0, 10),
        note: str(d.note),
        createdAt: str(d.created_at),
        updatedAt,
      },
    });
  } else {
    const lines = Array.isArray(d.lines) ? (d.lines as Record<string, unknown>[]) : [];
    await deps.repo.applyRemote(tripId, {
      kind,
      plan: {
        currency: row.pk,
        totalMinor: numOrNull(d.total_minor),
        dailyLimitMinor: numOrNull(d.daily_limit_minor),
        lines: lines.map((l) => ({ category: str(l.category), plannedMinor: num(l.plannedMinor ?? l.planned_minor) })),
      },
      updatedAt,
    });
  }
}

/**
 * After joining: make sure this account has a participant (owners and editors
 * add one for themselves; it is sent to the other members).
 */
export async function ensureMyParticipant(tripId: string, displayName: string, deps: { repo: ExpenseRepository; accountId: string; canWrite: boolean }) {
  const ws = await deps.repo.workspace(tripId);
  const mine = ws.participants.find((p) => p.userId === deps.accountId);
  if (mine) {
    if (!mine.isMe) await deps.repo.setMe(tripId, mine.id);
    return;
  }
  if (!deps.canWrite) return;
  const me = ws.participants.find((p) => p.isMe && !p.userId);
  if (me) {
    await deps.repo.enqueue(tripId, 'participant', me.id);
    return;
  }
  let name = displayName.trim() || 'Me';
  if (ws.participants.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${name} (me)`;
  const created = await deps.repo.addParticipant(tripId, name, deps.accountId);
  await deps.repo.setMe(tripId, created.id);
  await deps.repo.enqueue(tripId, 'participant', created.id);
}
