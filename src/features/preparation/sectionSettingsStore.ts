import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { accountScoped } from '@/lib/accountScopedStores';

import { useChecklistStore } from './checklistStore';
import { tripOwner } from './model';
import type { NewSectionInput, SectionSettings } from './sectionExtrasRepository';

interface State {
  /** Settings by section id (device-only). */
  bySection: Record<string, SectionSettings>;
  load: (sectionIds: readonly string[]) => Promise<void>;
  createSection: (tripId: string, input: NewSectionInput) => Promise<string>;
  saveSettings: (tripId: string, sectionId: string, patch: Partial<SectionSettings>) => Promise<void>;
  renameSection: (tripId: string, sectionId: string, title: string) => Promise<void>;
  reorderSections: (tripId: string, orderedIds: readonly string[]) => Promise<void>;
  deleteSection: (tripId: string, sectionId: string) => Promise<void>;
  sectionForInventoryCategory: (tripId: string, categoryId: string) => Promise<{ sectionId: string; created: boolean }>;
}

/** Inline checklist section management (Checklist tab); sections themselves stay in the checklist store. */
export const useSectionSettingsStore = accountScoped(
  create<State>()((set, get) => {
    const reload = async (tripId: string, extra: readonly string[] = []) => {
      await useChecklistStore.getState().load(tripOwner(tripId));
      const ids = [...(useChecklistStore.getState().byOwner[`trip:${tripId}`]?.sections ?? []).map((s) => s.id), ...extra];
      await get().load(ids);
    };
    return {
      bySection: {},
      async load(sectionIds) {
        const { sectionExtras } = await getRepositories();
        const found = await sectionExtras.settings(sectionIds);
        set((s) => ({ bySection: { ...s.bySection, ...found } }));
      },
      async createSection(tripId, input) {
        const id = await (await getRepositories()).sectionExtras.createSection(tripOwner(tripId), input);
        await reload(tripId, [id]);
        return id;
      },
      async saveSettings(tripId, sectionId, patch) {
        await (await getRepositories()).sectionExtras.saveSettings(sectionId, patch);
        await reload(tripId);
      },
      async renameSection(tripId, sectionId, title) {
        await (await getRepositories()).sectionExtras.renameSection(tripId, sectionId, title);
        await reload(tripId);
      },
      async reorderSections(tripId, orderedIds) {
        await (await getRepositories()).sectionExtras.reorderSections(tripId, orderedIds);
        await reload(tripId);
      },
      async deleteSection(tripId, sectionId) {
        await useChecklistStore.getState().deleteSection(tripOwner(tripId), sectionId);
        set((s) => {
          const next = { ...s.bySection };
          delete next[sectionId];
          return { bySection: next };
        });
      },
      async sectionForInventoryCategory(tripId, categoryId) {
        const result = await (await getRepositories()).sectionExtras.sectionForInventoryCategory(tripOwner(tripId), categoryId);
        await reload(tripId, [result.sectionId]);
        return result;
      },
    };
  }),
);
