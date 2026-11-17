import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';

import { useChecklistStore } from './checklistStore';
import { ownerKey, type ChecklistOwner, type Priority } from './model';
import { CLOTHING_SECTION_TITLE, findClothingSection, type ChecklistGroup, type TaskLink } from './sectionExtrasRepository';

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
  moveGroup: (sectionId: string, id: string, direction: -1 | 1) => Promise<void>;
  setTaskGroup: (sectionId: string, taskId: string, groupId: string | null) => Promise<void>;
  setQuantity: (sectionId: string, taskId: string, quantity: number) => Promise<void>;
  setInventoryLink: (sectionId: string, taskId: string, itemId: string | null) => Promise<void>;
  arrangeSection: (owner: ChecklistOwner, sectionId: string, layout: { groupIds: string[]; tasks: { id: string; groupId: string | null }[] }) => Promise<void>;
  addManual: (owner: ChecklistOwner, sectionId: string, groupId: string | null, title: string, priority: Priority) => Promise<void>;
  addFromInventory: (owner: ChecklistOwner, sectionId: string, groupId: string | null, items: { itemId: string; quantity?: number }[]) => Promise<{ added: number; skipped: number }>;
  /** The trip's Clothing checklist section, created (once) when the trip has none. */
  ensureClothingSection: (owner: ChecklistOwner) => Promise<string>;
}

let ensuring: Promise<string> | null = null;

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
      async moveGroup(sectionId, id, direction) {
        const { sectionExtras } = await getRepositories();
        const ids = (await sectionExtras.groups(sectionId)).map((g) => g.id);
        const i = ids.indexOf(id);
        const j = i + direction;
        if (i >= 0 && j >= 0 && j < ids.length) {
          [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
          await sectionExtras.reorderGroups(sectionId, ids);
        }
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
      async arrangeSection(owner, sectionId, layout) {
        try {
          await (await getRepositories()).sectionExtras.arrangeSection(sectionId, layout);
        } finally {
          // Reload either way, so a refused (stale) arrangement shows the real order again.
          await after(sectionId, owner);
        }
      },
      async setInventoryLink(sectionId, taskId, itemId) {
        await (await getRepositories()).sectionExtras.setInventoryLink(taskId, itemId);
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
      ensureClothingSection(owner) {
        // One at a time, so two quick taps never create two Clothing sections.
        ensuring ??= (async () => {
          const checklists = useChecklistStore.getState();
          await checklists.load(owner);
          const entry = useChecklistStore.getState().byOwner[ownerKey(owner)];
          // Never create a second Clothing section because the checklist failed to load.
          if (entry?.status !== 'ready') throw new Error(entry?.error ?? 'Could not load this trip’s checklist.');
          const found = findClothingSection(entry.sections);
          if (found) return found.id;
          return (await checklists.addSection(owner, CLOTHING_SECTION_TITLE)).id;
        })().finally(() => {
          ensuring = null;
        });
        return ensuring;
      },
    };
  }),
);

export function useSectionExtras(sectionId: string | undefined): SectionExtras {
  return useSectionExtrasStore((s) => (sectionId ? s.bySection[sectionId] : undefined) ?? EMPTY);
}
