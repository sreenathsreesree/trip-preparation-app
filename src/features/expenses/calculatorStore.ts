import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';

import type { CalcHistoryEntry } from './calculatorRepository';

interface CalculatorState {
  /** History per trip (this account only: the store resets when the account changes). */
  byTrip: Record<string, CalcHistoryEntry[]>;
  load: (tripId: string) => Promise<void>;
  record: (tripId: string, expression: string, result: string) => Promise<void>;
  remove: (tripId: string, id: string) => Promise<void>;
  clear: (tripId: string) => Promise<void>;
}

export const useCalculatorStore = accountScoped(
  create<CalculatorState>()((set) => {
    async function refresh(tripId: string) {
      const { calculator } = await getRepositories();
      const list = await calculator.history(tripId);
      set((s) => ({ byTrip: { ...s.byTrip, [tripId]: list } }));
    }
    return {
      byTrip: {},
      load: (tripId) => refresh(tripId),
      async record(tripId, expression, result) {
        const { calculator } = await getRepositories();
        await calculator.add(tripId, expression, result);
        await refresh(tripId);
      },
      async remove(tripId, id) {
        const { calculator } = await getRepositories();
        await calculator.remove(tripId, id);
        await refresh(tripId);
      },
      async clear(tripId) {
        const { calculator } = await getRepositories();
        await calculator.clear(tripId);
        await refresh(tripId);
      },
    };
  }),
);

const NONE: CalcHistoryEntry[] = [];
export const useCalcHistory = (tripId: string | undefined) => useCalculatorStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? NONE);
