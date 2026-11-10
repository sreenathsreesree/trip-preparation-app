import { colors } from '@/theme';
import type { IconName } from '@/theme/icons';

import { TRANSPORT_MODE_META, type PrepProgress, type TransportMode } from '../trips/model';

export const PREP_SECTIONS = ['packing', 'documents', 'vehicle', 'tasks', 'shopping', 'home'] as const;
export type PrepSectionId = (typeof PREP_SECTIONS)[number];

interface PrepSectionMeta {
  title: string;
  description: string;
  icon: IconName;
  tint: string;
  /** Prompt shown in the "add item" input for this section. */
  addPlaceholder: string;
}

export const PREP_SECTION_META: Record<PrepSectionId, PrepSectionMeta> = {
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
};

export interface PrepItem {
  id: string;
  tripId: string;
  section: PrepSectionId;
  title: string;
  isDone: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export const PREP_ITEM_TITLE_MAX = 120;

export function isPrepSectionId(value: unknown): value is PrepSectionId {
  return typeof value === 'string' && (PREP_SECTIONS as readonly string[]).includes(value);
}

/** Sections shown for a trip; vehicle readiness only applies when driving or riding. */
export function getApplicableSections(mode: TransportMode): PrepSectionId[] {
  return PREP_SECTIONS.filter(
    (section) => section !== 'vehicle' || TRANSPORT_MODE_META[mode].needsVehicleReadiness,
  );
}

export function summarizeItems(items: readonly PrepItem[]): PrepProgress {
  let done = 0;
  for (const item of items) if (item.isDone) done += 1;
  return { total: items.length, done };
}

export function groupItemsBySection(
  items: readonly PrepItem[],
): Record<PrepSectionId, PrepItem[]> {
  const groups = Object.fromEntries(PREP_SECTIONS.map((section) => [section, [] as PrepItem[]])) as Record<
    PrepSectionId,
    PrepItem[]
  >;
  for (const item of items) groups[item.section].push(item);
  for (const section of PREP_SECTIONS) groups[section].sort((a, b) => a.position - b.position);
  return groups;
}

export function normalizeItemTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}
