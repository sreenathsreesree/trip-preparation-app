import { colors } from '@/theme';
import type { IconName } from '@/theme/icons';

import { TRANSPORT_MODE_META, type TransportMode } from '../trips/model';

/** The six standard preparation areas. */
export const STANDARD_SECTION_KINDS = [
  'packing',
  'documents',
  'vehicle',
  'tasks',
  'shopping',
  'home',
] as const;
export type StandardSectionKind = (typeof STANDARD_SECTION_KINDS)[number];
/** Sections are either one of the standard areas or user-defined. */
export type SectionKind = StandardSectionKind | 'custom';

interface SectionMeta {
  title: string;
  description: string;
  icon: IconName;
  tint: string;
  /** Prompt shown in the "add task" input for this section. */
  addPlaceholder: string;
}

export const SECTION_META: Record<SectionKind, SectionMeta> = {
  packing: {
    title: 'Packing',
    description: 'Clothes, gear and essentials for every traveller.',
    icon: 'bag-suitcase-outline',
    tint: colors.accent,
    addPlaceholder: 'Add something to pack',
  },
  documents: {
    title: 'Documents',
    description: 'IDs, tickets, bookings and permits.',
    icon: 'card-account-details-outline',
    tint: colors.info,
    addPlaceholder: 'Add a document',
  },
  vehicle: {
    title: 'Vehicle readiness',
    description: 'Make sure your ride is road-ready.',
    icon: 'car-wrench',
    tint: colors.warning,
    addPlaceholder: 'Add a vehicle check',
  },
  tasks: {
    title: 'Preparation tasks',
    description: 'Bookings, errands and to-dos before you leave.',
    icon: 'clipboard-text-clock-outline',
    tint: colors.info,
    addPlaceholder: 'Add a task',
  },
  shopping: {
    title: 'Shopping',
    description: 'Things to buy before departure.',
    icon: 'cart-outline',
    tint: colors.accent,
    addPlaceholder: 'Add something to buy',
  },
  home: {
    title: 'Home departure',
    description: 'Lock up and switch off before you head out.',
    icon: 'home-lock',
    tint: colors.warning,
    addPlaceholder: 'Add a departure check',
  },
  custom: {
    title: 'Custom',
    description: 'Your own checklist section.',
    icon: 'format-list-checks',
    tint: colors.info,
    addPlaceholder: 'Add a task',
  },
};

export const PRIORITIES = ['essential', 'recommended', 'optional'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<
  Priority,
  { label: string; description: string; color: string; icon: IconName }
> = {
  essential: {
    label: 'Essential',
    description: 'You cannot leave without it. Blocks departure readiness.',
    color: colors.danger,
    icon: 'alert-decagram',
  },
  recommended: {
    label: 'Recommended',
    description: 'Should be done. Counts towards readiness.',
    color: colors.info,
    icon: 'star-four-points-outline',
  },
  optional: {
    label: 'Optional',
    description: 'Nice to have. Never blocks readiness.',
    color: colors.textMuted,
    icon: 'circle-outline',
  },
};

export const CHECKLIST_LIMITS = {
  sectionTitleMax: 40,
  taskTitleMax: 120,
  taskDescriptionMax: 500,
  taskNotesMax: 1000,
  templateNameMax: 60,
  templateDescriptionMax: 200,
} as const;

/** Who a checklist belongs to: a trip (with completion) or a reusable template. */
export type ChecklistOwner = { type: 'trip'; id: string } | { type: 'template'; id: string };

export const tripOwner = (id: string): ChecklistOwner => ({ type: 'trip', id });
export const templateOwner = (id: string): ChecklistOwner => ({ type: 'template', id });
export const ownerKey = (owner: ChecklistOwner) => `${owner.type}:${owner.id}`;

export interface ChecklistSection {
  id: string;
  owner: ChecklistOwner;
  title: string;
  kind: SectionKind;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTask {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  notes: string;
  priority: Priority;
  /** Always false for template tasks; completion only exists on trips. */
  isDone: boolean;
  position: number;
  /** Provenance when copied from a template (informational; templates may change or be deleted). */
  sourceTemplateId: string | null;
  sourceTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Checklist {
  sections: ChecklistSection[];
  tasks: ChecklistTask[];
}

export interface TaskDraft {
  title: string;
  description: string;
  notes: string;
  priority: Priority;
}

/** A checklist to add in one step (starter checklists, applying templates). */
export interface ChecklistPlan {
  sections: PlanSection[];
}

export interface PlanSection {
  title: string;
  kind: SectionKind;
  tasks: PlanTask[];
}

export interface PlanTask {
  title: string;
  priority: Priority;
  description?: string;
  notes?: string;
  sourceTemplateId?: string | null;
  sourceTaskId?: string | null;
}

export function isStandardSectionKind(value: unknown): value is StandardSectionKind {
  return typeof value === 'string' && (STANDARD_SECTION_KINDS as readonly string[]).includes(value);
}

export function parseSectionKind(value: unknown): SectionKind {
  return isStandardSectionKind(value) ? value : 'custom';
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/** Unknown stored values are treated as "recommended" so they still count. */
export function parsePriority(value: unknown): Priority {
  return isPriority(value) ? value : 'recommended';
}

/** Standard sections a trip starts with; vehicle readiness only when driving or riding. */
export function getStandardSectionsFor(mode: TransportMode): StandardSectionKind[] {
  return STANDARD_SECTION_KINDS.filter(
    (kind) => kind !== 'vehicle' || TRANSPORT_MODE_META[mode].needsVehicleReadiness,
  );
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

const matchKey = (title: string) => normalizeTitle(title).toLocaleLowerCase();

export function sortByPosition<T extends { position: number; createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function groupTasksBySection(tasks: readonly ChecklistTask[]): Map<string, ChecklistTask[]> {
  const groups = new Map<string, ChecklistTask[]>();
  for (const task of sortByPosition(tasks)) {
    const list = groups.get(task.sectionId);
    if (list) list.push(task);
    else groups.set(task.sectionId, [task]);
  }
  return groups;
}

export function emptyTaskDraft(priority: Priority = 'recommended'): TaskDraft {
  return { title: '', description: '', notes: '', priority };
}

export function validateTaskDraft(draft: TaskDraft): Partial<Record<keyof TaskDraft, string>> {
  const errors: Partial<Record<keyof TaskDraft, string>> = {};
  const title = normalizeTitle(draft.title);
  if (title.length === 0) errors.title = 'Give the task a title.';
  else if (title.length > CHECKLIST_LIMITS.taskTitleMax)
    errors.title = `Keep it under ${CHECKLIST_LIMITS.taskTitleMax} characters.`;
  if (draft.description.trim().length > CHECKLIST_LIMITS.taskDescriptionMax)
    errors.description = `Keep it under ${CHECKLIST_LIMITS.taskDescriptionMax} characters.`;
  if (draft.notes.trim().length > CHECKLIST_LIMITS.taskNotesMax)
    errors.notes = `Keep it under ${CHECKLIST_LIMITS.taskNotesMax} characters.`;
  if (!isPriority(draft.priority)) errors.priority = 'Choose a priority.';
  return errors;
}

/** Existing checklist content that a plan is merged into. */
export interface MergeTargetSection {
  key: string;
  title: string;
  kind: SectionKind;
  taskTitles: readonly string[];
  sourceTaskIds: readonly string[];
}

export interface MergeResult {
  /** Tasks to append to existing sections, by section key. */
  additions: { sectionKey: string; tasks: PlanTask[] }[];
  /** Sections that do not exist yet, with their tasks. */
  newSections: PlanSection[];
  added: number;
  skipped: number;
}

/**
 * Merges a plan into existing sections without touching existing tasks.
 *
 * - A plan section joins an existing section of the same standard kind, or one
 *   with the same title (case-insensitive); otherwise it becomes a new section.
 * - A task is skipped when that section already has a task copied from the same
 *   template task, or a task with the same title — so re-applying a template
 *   only adds what is missing and never duplicates or overwrites.
 */
export function planMerge(target: readonly MergeTargetSection[], plan: ChecklistPlan): MergeResult {
  interface Slot {
    title: string;
    kind: SectionKind;
    existingKey: string | null;
    titles: Set<string>;
    sources: Set<string>;
    incoming: PlanTask[];
  }
  const slots: Slot[] = target.map((section) => ({
    title: section.title,
    kind: section.kind,
    existingKey: section.key,
    titles: new Set(section.taskTitles.map(matchKey)),
    sources: new Set(section.sourceTaskIds),
    incoming: [],
  }));
  let added = 0;
  let skipped = 0;

  for (const planSection of plan.sections) {
    const titleKey = matchKey(planSection.title);
    let slot =
      slots.find((s) => planSection.kind !== 'custom' && s.kind === planSection.kind) ??
      slots.find((s) => matchKey(s.title) === titleKey);
    if (!slot) {
      slot = {
        title: normalizeTitle(planSection.title),
        kind: planSection.kind,
        existingKey: null,
        titles: new Set(),
        sources: new Set(),
        incoming: [],
      };
      slots.push(slot);
    }

    for (const task of planSection.tasks) {
      const title = normalizeTitle(task.title);
      const duplicate =
        title.length === 0 ||
        slot.titles.has(matchKey(title)) ||
        (task.sourceTaskId ? slot.sources.has(task.sourceTaskId) : false);
      if (duplicate) {
        skipped += 1;
        continue;
      }
      slot.titles.add(matchKey(title));
      if (task.sourceTaskId) slot.sources.add(task.sourceTaskId);
      slot.incoming.push({ ...task, title });
      added += 1;
    }
  }

  return {
    additions: slots
      .filter((slot) => slot.existingKey !== null && slot.incoming.length > 0)
      .map((slot) => ({ sectionKey: slot.existingKey as string, tasks: slot.incoming })),
    newSections: slots
      .filter((slot) => slot.existingKey === null)
      .map((slot) => ({ title: slot.title, kind: slot.kind, tasks: slot.incoming })),
    added,
    skipped,
  };
}

/** Combines plans into one (used when a new trip starts from several sources). */
export function mergePlans(...plans: ChecklistPlan[]): ChecklistPlan {
  let combined: PlanSection[] = [];
  for (const plan of plans) {
    const target: MergeTargetSection[] = combined.map((section, index) => ({
      key: String(index),
      title: section.title,
      kind: section.kind,
      taskTitles: section.tasks.map((task) => task.title),
      sourceTaskIds: section.tasks.flatMap((task) => (task.sourceTaskId ? [task.sourceTaskId] : [])),
    }));
    const result = planMerge(target, plan);
    combined = combined.map((section, index) => {
      const extra = result.additions.find((addition) => addition.sectionKey === String(index));
      return extra ? { ...section, tasks: [...section.tasks, ...extra.tasks] } : section;
    });
    combined.push(...result.newSections);
  }
  return { sections: combined };
}

/** Empty standard sections for a trip that starts without a pre-filled checklist. */
export function standardSectionsPlan(mode: TransportMode): ChecklistPlan {
  return {
    sections: getStandardSectionsFor(mode).map((kind) => ({
      title: SECTION_META[kind].title,
      kind,
      tasks: [],
    })),
  };
}
