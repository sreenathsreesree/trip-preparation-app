import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';

import { useChecklistStore } from './checklistStore';
import type { ChecklistOwner, Priority } from './model';
import type { ChecklistGroup, TaskLink } from './sectionExtrasRepository';

export interface SectionExtras {
  status: 'idle' | 'loading' | 'ready' | 'error';
  groups: ChecklistGroup[];
  links: Record<string, TaskLink>;
}

const EMPTY: SectionExtras = { status: 'idle', groups: [], links: {} };

interface State {
  bySection: Record<string, SectionExtras>;
  load: (sectionId: string) => Promise<void>;
  addGroup: (sectionId: string, title: string) => Promise<void>;
  renameGroup: (sectionId: string, id: string, title: string) => Promise<void>;
  deleteGroup: (sectionId: string, id: string, moveTo: string | null) => Promise<void>;
  setTaskGroup: (sectionId: string, taskId: string, groupId: string | null) => Promise<void>;
  setQuantity: (sectionId: string, taskId: string, quantity: number) => Promise<void>;
  addManual: (owner: ChecklistOwner, sectionId: string, groupId: string | null, title: string, priority: Priority) => Promise<void>;
  addFromInventory: (owner: ChecklistOwner, sectionId: string, groupId: string | null, items: { itemId: string; quantity?: number }[]) => Promise<{ added: number; skipped: number }>;
}

/** Groups and Inventory links of checklist sections; tasks stay in the checklist store. */
export const useSectionExtrasStore = accountScoped(
  create<State>()((set) => {
    const refresh = async (sectionId: string) => {
      const { sectionExtras } = await getRepositories();
      const [groups, links] = await Promise.all([sectionExtras.groups(sectionId), sectionExtras.links(sectionId)]);
      set((s) => ({ bySection: { ...s.bySection, [sectionId]: { status: 'ready', groups, links } } }));
    };
    const after = async (sectionId: string, owner?: ChecklistOwner) => {
      await refresh(sectionId);
      if (owner) await useChecklistStore.getState().load(owner);
    };
    return {
      bySection: {},
      async load(sectionId) {
        set((s) => ({ bySection: { ...s.bySection, [sectionId]: { ...(s.bySection[sectionId] ?? EMPTY), status: s.bySection[sectionId]?.status === 'ready' ? 'ready' : 'loading' } } }));
        try {
          await refresh(sectionId);
        } catch {
          set((s) => ({ bySection: { ...s.bySection, [sectionId]: { ...(s.bySection[sectionId] ?? EMPTY), status: 'error' } } }));
        }
      },
      async addGroup(sectionId, title) {
        await (await getRepositories()).sectionExtras.addGroup(sectionId, title);
        await after(sectionId);
      },
      async renameGroup(sectionId, id, title) {
        await (await getRepositories()).sectionExtras.renameGroup(id, title);
        await after(sectionId);
      },
      async deleteGroup(sectionId, id, moveTo) {
        await (await getRepositories()).sectionExtras.deleteGroup(id, moveTo);
        await after(sectionId);
      },
      async setTaskGroup(sectionId, taskId, groupId) {
        await (await getRepositories()).sectionExtras.setTaskGroup(taskId, groupId);
        await after(sectionId);
      },
      async setQuantity(sectionId, taskId, quantity) {
        await (await getRepositories()).sectionExtras.setQuantity(taskId, quantity);
        await after(sectionId);
      },
      async addManual(owner, sectionId, groupId, title, priority) {
        await (await getRepositories()).sectionExtras.addManual(sectionId, groupId, title, priority);
        await after(sectionId, owner);
      },
      async addFromInventory(owner, sectionId, groupId, items) {
        const result = await (await getRepositories()).sectionExtras.addFromInventory(sectionId, groupId, items);
        await after(sectionId, owner);
        return result;
      },
    };
  }),
);

export function useSectionExtras(sectionId: string | undefined): SectionExtras {
  return useSectionExtrasStore((s) => (sectionId ? s.bySection[sectionId] : undefined) ?? EMPTY);
}
