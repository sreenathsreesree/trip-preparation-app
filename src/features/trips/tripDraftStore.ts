import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import type { ISODate } from '@/lib/dates';

import { TRIP_LIMITS } from './validation';
import type { Trip, TravellerKind } from './model';
import {
  editMinStartDate,
  tripToDraft,
  type DraftTraveller,
  type TripDraft,
  type TripDraftField,
} from './validation';

export const CREATE_TRIP_STEPS = [
  {
    key: 'basics',
    title: 'What kind of trip?',
    subtitle: 'Name it and pick the kind of trip. You plan the destinations next, in the planner.',
    fields: ['name', 'category'],
  },
  {
    key: 'when',
    title: 'When and who?',
    subtitle: 'Pick your travel dates and who is coming along.',
    fields: ['startDate', 'endDate', 'travellers'],
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

export const ALL_TRIP_FIELDS: readonly TripDraftField[] = CREATE_TRIP_STEPS.flatMap((step) => step.fields);

let keySequence = 0;
/** Stable React key for a new, unsaved row. */
export function newRowKey(): string {
  keySequence += 1;
  return `new-${keySequence}`;
}

export function blankDraft(): TripDraft {
  return {
    name: '',
    startDate: null,
    endDate: null,
    travellers: [{ key: newRowKey(), name: 'Me', kind: 'adult' }],
    transportMode: null,
    category: null,
  };
}

export type TripFormMode = 'create' | 'edit';

interface TripDraftState {
  mode: TripFormMode;
  /** Trip being edited (edit mode only). */
  tripId: string | null;
  draft: TripDraft;
  minStartDate: ISODate;
  step: number;
  withStarterChecklist: boolean;
  templateIds: string[];
  /** Fields whose errors should be visible (touched or step submitted). */
  revealed: Partial<Record<TripDraftField, true>>;
  startCreate: (today: ISODate) => void;
  startEdit: (trip: Trip, today: ISODate) => void;
  update: (patch: Partial<Pick<TripDraft, 'name' | 'transportMode' | 'category'>>) => void;
  setDates: (startDate: ISODate | null, endDate: ISODate | null) => void;
  addTraveller: () => void;
  updateTraveller: (key: string, patch: Partial<Pick<DraftTraveller, 'name' | 'kind'>>) => void;
  removeTraveller: (key: string) => void;
  setWithStarterChecklist: (value: boolean) => void;
  toggleTemplate: (templateId: string) => void;
  reveal: (fields: readonly TripDraftField[]) => void;
  goTo: (step: number) => void;
}

export const useTripDraftStore = accountScoped(create<TripDraftState>()((set) => {
  const patchDraft = (fn: (draft: TripDraft) => Partial<TripDraft>) =>
    set((state) => ({ draft: { ...state.draft, ...fn(state.draft) } }));

  return {
    mode: 'create',
    tripId: null,
    draft: blankDraft(),
    minStartDate: '1970-01-01',
    step: 0,
    withStarterChecklist: true,
    templateIds: [],
    revealed: {},

    startCreate(today) {
      set({
        mode: 'create',
        tripId: null,
        draft: blankDraft(),
        minStartDate: today,
        step: 0,
        withStarterChecklist: true,
        templateIds: [],
        revealed: {},
      });
    },

    startEdit(trip, today) {
      set({
        mode: 'edit',
        tripId: trip.id,
        draft: tripToDraft(trip),
        minStartDate: editMinStartDate(trip.startDate, today),
        step: 0,
        withStarterChecklist: false,
        templateIds: [],
        revealed: {},
      });
    },

    update(patch) {
      patchDraft(() => patch);
    },

    setDates(startDate, endDate) {
      patchDraft(() => ({ startDate, endDate }));
    },


    addTraveller() {
      patchDraft((draft) =>
        draft.travellers.length >= TRIP_LIMITS.travellersMax
          ? {}
          : {
              travellers: [
                ...draft.travellers,
                { key: newRowKey(), name: '', kind: 'adult' as TravellerKind },
              ],
            },
      );
    },

    updateTraveller(key, patch) {
      patchDraft((draft) => ({
        travellers: draft.travellers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
      }));
    },

    removeTraveller(key) {
      patchDraft((draft) =>
        draft.travellers.length <= 1 ? {} : { travellers: draft.travellers.filter((t) => t.key !== key) },
      );
    },

    setWithStarterChecklist(value) {
      set({ withStarterChecklist: value });
    },

    toggleTemplate(templateId) {
      set((state) => ({
        templateIds: state.templateIds.includes(templateId)
          ? state.templateIds.filter((id) => id !== templateId)
          : [...state.templateIds, templateId],
      }));
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
  };
}));
