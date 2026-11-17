import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';

import { useInventoryStore } from '../inventory/inventoryStore';
import { useChecklistStore } from '../preparation/checklistStore';
import { tripOwner, type Priority } from '../preparation/model';
import { usePackingStore } from './packingStore';
import type { OldChecklistTask } from './unifiedPackingRepository';

interface TripExtras {
  status: 'idle' | 'loading' | 'ready' | 'error';
  priorities: Record<string, Priority>;
  oldTasks: OldChecklistTask[];
}
const EMPTY: TripExtras = { status: 'idle', priorities: {}, oldTasks: [] };

interface State {
  byTrip: Record<string, TripExtras>;
  load: (tripId: string) => Promise<void>;
  setPriority: (tripId: string, entryId: string, priority: Priority | null) => Promise<void>;
  convertTask: (tripId: string, taskId: string) => Promise<void>;
  keepTask: (tripId: string, taskId: string) => Promise<void>;
  removeTask: (tripId: string, taskId: string) => Promise<void>;
  deleteCategoryMoving: (tripId: string | null, categoryId: string, moveTo: string | null) => Promise<void>;
}

/** Packing extras (priorities, old checklist tasks) per trip; packing items themselves stay in the packing store. */
export const useUnifiedPackingStore = accountScoped(
  create<State>()((set) => {
    const refresh = async (tripId: string) => {
      const { unifiedPacking } = await getRepositories();
      const [priorities, oldTasks] = await Promise.all([unifiedPacking.priorities(tripId), unifiedPacking.oldChecklistTasks(tripId)]);
      set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { status: 'ready', priorities, oldTasks } } }));
    };
    const afterTaskChange = async (tripId: string) => {
      await refresh(tripId);
      await Promise.all([usePackingStore.getState().load(tripId), useChecklistStore.getState().load(tripOwner(tripId))]);
    };
    return {
      byTrip: {},
      async load(tripId) {
        set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), status: s.byTrip[tripId]?.status === 'ready' ? 'ready' : 'loading' } } }));
        try {
          const { unifiedPacking } = await getRepositories();
          // The old Clothing organiser's categories become Clothing groups (repeat-safe).
          if ((await unifiedPacking.adoptClothingGroups(tripId)) > 0) {
            await Promise.all([usePackingStore.getState().load(tripId), useInventoryStore.getState().load()]);
          }
          await refresh(tripId);
        } catch {
          set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), status: 'error' } } }));
        }
      },
      async setPriority(tripId, entryId, priority) {
        await (await getRepositories()).unifiedPacking.setPriority(entryId, priority);
        await refresh(tripId);
      },
      async convertTask(tripId, taskId) {
        await (await getRepositories()).unifiedPacking.convertTask(tripId, taskId);
        await afterTaskChange(tripId);
      },
      async keepTask(tripId, taskId) {
        await (await getRepositories()).unifiedPacking.keepTask(tripId, taskId);
        await afterTaskChange(tripId);
      },
      async removeTask(tripId, taskId) {
        await (await getRepositories()).unifiedPacking.removeTask(tripId, taskId);
        await afterTaskChange(tripId);
      },
      async deleteCategoryMoving(tripId, categoryId, moveTo) {
        await (await getRepositories()).unifiedPacking.deleteCategoryMoving(categoryId, moveTo);
        await useInventoryStore.getState().load();
        if (tripId) await usePackingStore.getState().load(tripId);
      },
    };
  }),
);

export const useTripPackingExtras = (tripId: string | undefined) => useUnifiedPackingStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? EMPTY);
