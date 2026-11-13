import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import type { LoadStatus } from '../trips/tripsStore';
import type { TemplateInput, TemplateSummary } from './templateRepository';

interface TemplatesState {
  templates: TemplateSummary[];
  status: LoadStatus;
  error: string | null;
  load: () => Promise<void>;
  create: (input: TemplateInput) => Promise<TemplateSummary>;
  update: (id: string, input: TemplateInput) => Promise<TemplateSummary>;
  duplicate: (id: string) => Promise<TemplateSummary>;
  remove: (id: string) => Promise<void>;
  createFromTrip: (tripId: string, input: TemplateInput) => Promise<TemplateSummary>;
}

function sortTemplates(templates: TemplateSummary[]) {
  return [...templates].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.createdAt.localeCompare(b.createdAt),
  );
}

export const useTemplatesStore = accountScoped(create<TemplatesState>()((set, get) => {
  const upsert = (template: TemplateSummary) =>
    set((state) => ({
      templates: sortTemplates([...state.templates.filter((t) => t.id !== template.id), template]),
    }));

  return {
    templates: [],
    status: 'idle',
    error: null,

    async load() {
      set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null });
      try {
        const { templates } = await getRepositories();
        set({ templates: await templates.list(), status: 'ready', error: null });
      } catch (error) {
        set({ status: 'error', error: toErrorMessage(error, 'Could not load your templates.') });
      }
    },

    async create(input) {
      const { templates } = await getRepositories();
      const created = await templates.create(input);
      upsert(created);
      return created;
    },

    async update(id, input) {
      const { templates } = await getRepositories();
      const updated = await templates.update(id, input);
      upsert(updated);
      return updated;
    },

    async duplicate(id) {
      const { templates } = await getRepositories();
      const copy = await templates.duplicate(id);
      upsert(copy);
      return copy;
    },

    async remove(id) {
      const { templates } = await getRepositories();
      await templates.remove(id);
      set((state) => ({ templates: state.templates.filter((t) => t.id !== id) }));
    },

    async createFromTrip(tripId, input) {
      const { templates } = await getRepositories();
      const created = await templates.createFromTrip(tripId, input);
      upsert(created);
      return created;
    },
  };
}));
