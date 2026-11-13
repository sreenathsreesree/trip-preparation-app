import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { currentAccount, useSharingStore } from '../sharing/sharingStore';
import type { ExpenseInput, ExpenseRepository, OutboxKind, Workspace } from './expenseRepository';
import type { BudgetPlan } from './planning';

export interface TripLedger {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  workspace: Workspace | null;
}

const EMPTY: TripLedger = { status: 'idle', error: null, workspace: null };

interface ExpenseState {
  byTrip: Record<string, TripLedger>;
  load: (tripId: string) => Promise<void>;
  saveExpense: (tripId: string, input: ExpenseInput, id?: string | null) => Promise<string>;
  removeExpense: (tripId: string, id: string) => Promise<void>;
  addSettlement: (tripId: string, input: Parameters<ExpenseRepository['addSettlement']>[1]) => Promise<void>;
  removeSettlement: (tripId: string, id: string) => Promise<void>;
  saveBudget: (tripId: string, plan: BudgetPlan) => Promise<void>;
  setCurrency: (tripId: string, currency: string) => Promise<void>;
  addParticipant: (tripId: string, name: string) => Promise<void>;
  renameParticipant: (tripId: string, id: string, name: string) => Promise<void>;
  setMe: (tripId: string, id: string) => Promise<void>;
  setArchived: (tripId: string, id: string, archived: boolean) => Promise<void>;
  addCategory: (tripId: string, name: string) => Promise<string>;
  removeCategory: (tripId: string, id: string) => Promise<void>;
}

export const useExpenseStore = accountScoped(create<ExpenseState>()((set, get) => {
  const put = (tripId: string, patch: Partial<TripLedger>) =>
    set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), ...patch } } }));

  async function refresh(tripId: string) {
    const { expenses } = await getRepositories();
    put(tripId, { status: 'ready', error: null, workspace: await expenses.workspace(tripId) });
  }

  /** Runs a write; then queues the record for a shared trip (if any) and refreshes. */
  async function write<T>(tripId: string, fn: (repo: ExpenseRepository) => Promise<T>, queue?: (result: T) => { kind: OutboxKind; id: string; withdrawal?: boolean } | null) {
    const { expenses } = await getRepositories();
    try {
      const result = await fn(expenses);
      const item = queue?.(result);
      if (item && (await expenses.enqueue(tripId, item.kind, item.id, { withdrawal: item.withdrawal }))) {
        void useSharingStore.getState().sync(tripId);
      }
      return result;
    } finally {
      await refresh(tripId).catch(() => undefined);
    }
  }

  return {
    byTrip: {},

    async load(tripId) {
      if (!get().byTrip[tripId]?.workspace) put(tripId, { status: 'loading' });
      try {
        const { expenses } = await getRepositories();
        await expenses.ensureParticipants(tripId);
        await refresh(tripId);
      } catch (error) {
        put(tripId, { status: 'error', error: toErrorMessage(error, 'Could not load expenses.') });
      }
    },

    async saveExpense(tripId, input, id = null) {
      const { expenses } = await getRepositories();
      const before = id ? await expenses.expense(id) : null;
      const saved = await write(
        tripId,
        (repo) => repo.saveExpense(tripId, input, id, currentAccount()?.id ?? null),
        (e) =>
          e.scope === 'group'
            ? { kind: 'expense', id: e.id }
            : before?.scope === 'group'
              ? { kind: 'expense', id: e.id, withdrawal: true } // was shared: withdraw, never send the personal version
              : null,
      );
      return saved.id;
    },

    removeExpense: (tripId, id) =>
      write(
        tripId,
        (repo) => repo.removeExpense(id),
        (removed) => (removed?.scope === 'group' ? { kind: 'expense', id, withdrawal: true } : null),
      ).then(() => undefined),

    addSettlement: (tripId, input) =>
      write(
        tripId,
        (repo) => repo.addSettlement(tripId, input, currentAccount()?.id ?? null),
        (s) => ({ kind: 'settlement', id: s.id }),
      ).then(() => undefined),

    removeSettlement: (tripId, id) =>
      write(
        tripId,
        (repo) => repo.removeSettlement(id),
        (removed) => (removed ? { kind: 'settlement', id } : null),
      ).then(() => undefined),

    saveBudget: (tripId, plan) =>
      write(
        tripId,
        (repo) => repo.saveBudget(tripId, plan),
        () => ({ kind: 'budget', id: plan.currency }),
      ),

    setCurrency: (tripId, currency) => write(tripId, (repo) => repo.setCurrency(tripId, currency)),

    addParticipant: (tripId, name) =>
      write(
        tripId,
        (repo) => repo.addParticipant(tripId, name),
        (p) => ({ kind: 'participant', id: p.id }),
      ).then(() => undefined),

    renameParticipant: (tripId, id, name) =>
      write(
        tripId,
        (repo) => repo.renameParticipant(id, name),
        () => ({ kind: 'participant', id }),
      ),

    setMe: (tripId, id) => write(tripId, (repo) => repo.setMe(tripId, id)),

    setArchived: (tripId, id, archived) =>
      write(
        tripId,
        (repo) => repo.setArchived(id, archived),
        () => ({ kind: 'participant', id }),
      ),

    addCategory: (tripId, name) => write(tripId, (repo) => repo.addCategory(tripId, name)).then((c) => c.id),

    removeCategory: (tripId, id) => write(tripId, (repo) => repo.removeCategory(id)),
  };
}));

export function useTripLedger(tripId: string | undefined): TripLedger {
  return useExpenseStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? EMPTY);
}
