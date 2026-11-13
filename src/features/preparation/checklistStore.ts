import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import { useTripsStore, type LoadStatus } from '../trips/tripsStore';
import {
  mergePlans,
  ownerKey,
  tripOwner,
  type ChecklistOwner,
  type ChecklistPlan,
  type ChecklistSection,
  type ChecklistTask,
  type TaskDraft,
} from './model';
import { computeStats } from './readiness';
import { useTemplatesStore } from './templatesStore';

export interface ChecklistEntry {
  status: LoadStatus;
  sections: ChecklistSection[];
  tasks: ChecklistTask[];
  error: string | null;
}

export interface ApplyResult {
  added: number;
  skipped: number;
  sectionsAdded: number;
}

interface ChecklistState {
  byOwner: Record<string, ChecklistEntry>;
  load: (owner: ChecklistOwner) => Promise<void>;
  addSection: (owner: ChecklistOwner, title: string) => Promise<ChecklistSection>;
  renameSection: (owner: ChecklistOwner, sectionId: string, title: string) => Promise<void>;
  moveSection: (owner: ChecklistOwner, sectionId: string, direction: -1 | 1) => Promise<void>;
  deleteSection: (owner: ChecklistOwner, sectionId: string) => Promise<void>;
  addTask: (owner: ChecklistOwner, sectionId: string, draft: TaskDraft) => Promise<ChecklistTask>;
  updateTask: (
    owner: ChecklistOwner,
    taskId: string,
    draft: TaskDraft,
    options?: { sectionId?: string },
  ) => Promise<void>;
  /** Optimistic toggle (trip checklists only); reverts and rethrows if the write fails. */
  toggleTask: (owner: ChecklistOwner, taskId: string) => Promise<void>;
  moveTask: (owner: ChecklistOwner, taskId: string, direction: -1 | 1) => Promise<void>;
  deleteTask: (owner: ChecklistOwner, taskId: string) => Promise<void>;
  applyPlan: (owner: ChecklistOwner, plan: ChecklistPlan) => Promise<ApplyResult>;
  /** Copies tasks from templates into a trip; only missing tasks are added. */
  applyTemplates: (tripId: string, templateIds: readonly string[]) => Promise<ApplyResult>;
  forget: (owner: ChecklistOwner) => void;
}

export const EMPTY_CHECKLIST: ChecklistEntry = { status: 'idle', sections: [], tasks: [], error: null };

export const useChecklistStore = accountScoped(create<ChecklistState>()((set, get) => {
  const entryOf = (owner: ChecklistOwner) => get().byOwner[ownerKey(owner)] ?? EMPTY_CHECKLIST;

  function setEntry(owner: ChecklistOwner, entry: ChecklistEntry) {
    set((state) => ({ byOwner: { ...state.byOwner, [ownerKey(owner)]: entry } }));
    if (entry.status === 'ready') {
      if (owner.type === 'trip') {
        // Readiness on every trip list/summary updates as soon as tasks change.
        useTripsStore.getState().applyReadiness(owner.id, computeStats(entry.tasks));
      }
    }
  }

  async function refresh(owner: ChecklistOwner) {
    const { checklists } = await getRepositories();
    const { sections, tasks } = await checklists.load(owner);
    setEntry(owner, { status: 'ready', sections, tasks, error: null });
    if (owner.type === 'template') {
      // Section and task counts shown on template cards.
      void useTemplatesStore.getState().load();
    }
  }

  /** Runs a write, then reloads the owner's checklist so order and ids are authoritative. */
  async function mutate<T>(owner: ChecklistOwner, write: () => Promise<T>): Promise<T> {
    const result = await write();
    await refresh(owner);
    return result;
  }

  return {
    byOwner: {},

    async load(owner) {
      const current = entryOf(owner);
      setEntry(owner, { ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: null });
      try {
        await refresh(owner);
      } catch (error) {
        setEntry(owner, {
          ...entryOf(owner),
          status: 'error',
          error: toErrorMessage(error, 'Could not load this checklist.'),
        });
      }
    },

    async addSection(owner, title) {
      const { checklists } = await getRepositories();
      return mutate(owner, () => checklists.addSection(owner, title));
    },

    async renameSection(owner, sectionId, title) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.renameSection(sectionId, title));
    },

    async moveSection(owner, sectionId, direction) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.moveSection(sectionId, direction));
    },

    async deleteSection(owner, sectionId) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.deleteSection(sectionId));
    },

    async addTask(owner, sectionId, draft) {
      const { checklists } = await getRepositories();
      return mutate(owner, () => checklists.addTask(sectionId, draft));
    },

    async updateTask(owner, taskId, draft, options) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.updateTask(taskId, draft, options));
    },

    async toggleTask(owner, taskId) {
      if (owner.type !== 'trip') return;
      const current = entryOf(owner);
      const target = current.tasks.find((task) => task.id === taskId);
      if (!target) return;
      const nextDone = !target.isDone;
      const withValue = (value: boolean) => ({
        ...entryOf(owner),
        tasks: entryOf(owner).tasks.map((task) => (task.id === taskId ? { ...task, isDone: value } : task)),
      });

      setEntry(owner, withValue(nextDone));
      try {
        const { checklists } = await getRepositories();
        await checklists.setTaskDone(taskId, nextDone);
      } catch (error) {
        // Revert only this task so concurrent edits to others are kept.
        setEntry(owner, withValue(target.isDone));
        throw error;
      }
    },

    async moveTask(owner, taskId, direction) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.moveTask(taskId, direction));
    },

    async deleteTask(owner, taskId) {
      const { checklists } = await getRepositories();
      await mutate(owner, () => checklists.deleteTask(taskId));
    },

    async applyPlan(owner, plan) {
      const { checklists } = await getRepositories();
      return mutate(owner, () => checklists.applyPlan(owner, plan));
    },

    async applyTemplates(tripId, templateIds) {
      const { checklists, templates } = await getRepositories();
      const plans = await Promise.all(templateIds.map((id) => templates.toPlan(id)));
      const owner = tripOwner(tripId);
      return mutate(owner, () => checklists.applyPlan(owner, mergePlans(...plans)));
    },

    forget(owner) {
      set((state) => {
        const next = { ...state.byOwner };
        delete next[ownerKey(owner)];
        return { byOwner: next };
      });
    },
  };
}));

export function useChecklist(owner: ChecklistOwner | null): ChecklistEntry {
  return useChecklistStore((state) => (owner ? state.byOwner[ownerKey(owner)] : undefined) ?? EMPTY_CHECKLIST);
}
