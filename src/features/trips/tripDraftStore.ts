import { create } from 'zustand';

import type { TripDraft, TripDraftField } from './validation';

export const CREATE_TRIP_STEPS = [
  {
    key: 'basics',
    title: 'Where to?',
    subtitle: 'Name the trip and tell us what kind it is.',
    fields: ['name', 'destination', 'category'],
  },
  {
    key: 'when',
    title: 'When and who?',
    subtitle: 'Pick your travel dates and who is coming along.',
    fields: ['startDate', 'endDate', 'adults', 'children'],
  },
  {
    key: 'how',
    title: 'How are you travelling?',
    subtitle: 'Your transport shapes the documents and vehicle checks you need.',
    fields: ['transportMode'],
  },
] as const satisfies readonly {
  key: string;
  title: string;
  subtitle: string;
  fields: readonly TripDraftField[];
}[];

export const INITIAL_DRAFT: TripDraft = {
  name: '',
  destination: '',
  startDate: null,
  endDate: null,
  adults: 1,
  children: 0,
  transportMode: null,
  category: null,
};

interface TripDraftState {
  draft: TripDraft;
  step: number;
  withStarterChecklist: boolean;
  /** Fields whose errors should be visible (touched or step submitted). */
  revealed: Partial<Record<TripDraftField, true>>;
  update: (patch: Partial<TripDraft>) => void;
  setDates: (startDate: string | null, endDate: string | null) => void;
  setWithStarterChecklist: (value: boolean) => void;
  reveal: (fields: readonly TripDraftField[]) => void;
  goTo: (step: number) => void;
  reset: () => void;
}

export const useTripDraftStore = create<TripDraftState>()((set) => ({
  draft: INITIAL_DRAFT,
  step: 0,
  withStarterChecklist: true,
  revealed: {},

  update(patch) {
    set((state) => ({ draft: { ...state.draft, ...patch } }));
  },

  setDates(startDate, endDate) {
    set((state) => ({ draft: { ...state.draft, startDate, endDate } }));
  },

  setWithStarterChecklist(value) {
    set({ withStarterChecklist: value });
  },

  reveal(fields) {
    set((state) => {
      const revealed = { ...state.revealed };
      for (const field of fields) revealed[field] = true;
      return { revealed };
    });
  },

  goTo(step) {
    set({ step: Math.max(0, Math.min(CREATE_TRIP_STEPS.length - 1, step)) });
  },

  reset() {
    set({ draft: INITIAL_DRAFT, step: 0, withStarterChecklist: true, revealed: {} });
  },
}));
