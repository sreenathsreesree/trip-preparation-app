import type { IconName } from '@/theme/icons';

import type { TreeItem } from './model';

/**
 * The destination companion: per-place state and the user's own information
 * (visit status, cover, tags, facts, preparation, notes, saved notices,
 * memories) plus the independent Navigation list.
 *
 * Everything here is the user's data or user-chosen; nothing is invented. Live
 * provider data (ratings, opening hours, weather, routes) is shown only when a
 * provider supplies it, with its source.
 */

export type VisitStatus = 'upcoming' | 'visited';

export const BEST_TIMES = ['sunrise', 'morning', 'midday', 'afternoon', 'sunset', 'evening', 'night', 'any'] as const;
export type BestTime = (typeof BEST_TIMES)[number];
export const BEST_TIME_LABELS: Record<BestTime, string> = {
  sunrise: 'Sunrise',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  sunset: 'Sunset',
  evening: 'Evening',
  night: 'Night',
  any: 'Any time',
};
export const isBestTime = (v: unknown): v is BestTime => typeof v === 'string' && (BEST_TIMES as readonly string[]).includes(v);

/** Suggested tags; users can add their own. */
export const PRESET_TAGS = ['Must visit', 'Photography', 'Family friendly', 'Hidden gem'] as const;

export const COMPANION_LIMITS = {
  textMax: 2000,
  titleMax: 120,
  shortMax: 200,
  tagMax: 24,
  tagsMax: 12,
  photosMax: 30,
  visitMinutesMax: 10080,
} as const;

export interface NodeProfile {
  nodeId: string;
  tripId: string;
  visitStatus: VisitStatus;
  visitedAt: string | null;
  /** Saved for later / favourite. */
  saved: boolean;
  coverImageUri: string | null;
  tags: string[];
  /** The user's own description of the place. */
  about: string;
  bestSeason: string;
  entryFee: string;
  travelInfo: string;
  /** Planned time at the place (the user's estimate), in minutes. */
  visitMinutes: number | null;
  bestTime: BestTime | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ProfilePatch = Partial<
  Pick<
    NodeProfile,
    'saved' | 'coverImageUri' | 'tags' | 'about' | 'bestSeason' | 'entryFee' | 'travelInfo' | 'visitMinutes' | 'bestTime'
  >
>;

/** The profile of a place nobody has edited yet. */
export function emptyProfile(nodeId: string, tripId: string): NodeProfile {
  return {
    nodeId,
    tripId,
    visitStatus: 'upcoming',
    visitedAt: null,
    saved: false,
    coverImageUri: null,
    tags: [],
    about: '',
    bestSeason: '',
    entryFee: '',
    travelInfo: '',
    visitMinutes: null,
    bestTime: null,
    createdAt: null,
    updatedAt: null,
  };
}

/** Normalises tags: trimmed, short, unique (case-insensitive), capped in number. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, COMPANION_LIMITS.tagMax);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= COMPANION_LIMITS.tagsMax) break;
  }
  return result;
}

/** How long a visit is, in words: quick stop, a few hours, half day or full day. */
export function visitLength(minutes: number | null): { label: string; icon: IconName } | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes < 60) return { label: 'Quick stop', icon: 'timer-sand' };
  if (minutes < 180) return { label: 'A couple of hours', icon: 'clock-outline' };
  if (minutes <= 300) return { label: 'Half day', icon: 'weather-sunset-up' };
  return { label: 'Full day', icon: 'white-balance-sunny' };
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/* ------------------------------------------------------------------ */
/* Preparation tasks                                                   */
/* ------------------------------------------------------------------ */

export const TASK_CATEGORIES = [
  'tickets',
  'weather',
  'carry',
  'clothing',
  'stay',
  'transport',
  'timings',
  'requirements',
  'other',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_META: Record<TaskCategory, { label: string; icon: IconName }> = {
  tickets: { label: 'Tickets and permits', icon: 'ticket-confirmation-outline' },
  weather: { label: 'Weather preparation', icon: 'weather-partly-rainy' },
  carry: { label: 'Things to carry', icon: 'bag-personal-outline' },
  clothing: { label: 'Clothing and essentials', icon: 'tshirt-crew-outline' },
  stay: { label: 'Stay and accommodation', icon: 'bed-outline' },
  transport: { label: 'Parking and local transport', icon: 'car-outline' },
  timings: { label: 'Opening hours and timings', icon: 'clock-outline' },
  requirements: { label: 'Important requirements', icon: 'alert-circle-outline' },
  other: { label: 'Other', icon: 'checkbox-marked-circle-outline' },
};
export const isTaskCategory = (v: unknown): v is TaskCategory =>
  typeof v === 'string' && (TASK_CATEGORIES as readonly string[]).includes(v);

/**
 * Optional, generic preparation prompts (things to check, not facts about the
 * place). Shown only as suggestions; added only when the user picks them.
 */
export const SUGGESTED_TASKS: readonly { category: TaskCategory; title: string }[] = [
  { category: 'tickets', title: 'Check whether tickets or permits are needed' },
  { category: 'tickets', title: 'Book entry tickets in advance if required' },
  { category: 'weather', title: 'Check the forecast the day before' },
  { category: 'carry', title: 'Carry water and snacks' },
  { category: 'carry', title: 'Carry cash for entry or parking' },
  { category: 'clothing', title: 'Wear comfortable walking shoes' },
  { category: 'stay', title: 'Confirm the stay booking' },
  { category: 'transport', title: 'Check parking or local transport options' },
  { category: 'timings', title: 'Check opening hours and closing days' },
  { category: 'requirements', title: 'Check dress code or photography rules' },
];

export interface NodeTask {
  id: string;
  nodeId: string;
  tripId: string;
  category: TaskCategory;
  title: string;
  notes: string;
  isDone: boolean;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function taskProgress(tasks: readonly Pick<NodeTask, 'isDone'>[]) {
  const done = tasks.filter((t) => t.isDone).length;
  return { done, total: tasks.length, percent: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100) };
}

/* ------------------------------------------------------------------ */
/* Notes, notices, memories                                            */
/* ------------------------------------------------------------------ */

export const NOTE_KINDS = ['why', 'experience', 'food', 'photo', 'stay', 'timing', 'tickets', 'reminder', 'other'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_META: Record<NoteKind, { label: string; icon: IconName }> = {
  why: { label: 'Why I want to visit', icon: 'heart-outline' },
  experience: { label: 'Things to experience', icon: 'star-outline' },
  food: { label: 'Food to try', icon: 'food-outline' },
  photo: { label: 'Photography ideas', icon: 'camera-outline' },
  stay: { label: 'Stay', icon: 'bed-outline' },
  timing: { label: 'Timings', icon: 'clock-outline' },
  tickets: { label: 'Tickets', icon: 'ticket-outline' },
  reminder: { label: 'Personal reminder', icon: 'bell-outline' },
  other: { label: 'Other', icon: 'note-text-outline' },
};
export const isNoteKind = (v: unknown): v is NoteKind => typeof v === 'string' && (NOTE_KINDS as readonly string[]).includes(v);

export interface NodeNote {
  id: string;
  nodeId: string;
  tripId: string;
  kind: NoteKind;
  body: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export const ALERT_KINDS = ['closure', 'restricted', 'permit', 'seasonal', 'weather', 'booking', 'info'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_KIND_META: Record<AlertKind, { label: string; icon: IconName }> = {
  closure: { label: 'Road closure', icon: 'road-variant' },
  restricted: { label: 'Restricted access', icon: 'cancel' },
  permit: { label: 'Permit or e-pass', icon: 'card-account-details-outline' },
  seasonal: { label: 'Seasonal closure', icon: 'calendar-remove-outline' },
  weather: { label: 'Weather warning', icon: 'weather-lightning-rainy' },
  booking: { label: 'Booking required', icon: 'calendar-check-outline' },
  info: { label: 'Information', icon: 'information-outline' },
};
export const isAlertKind = (v: unknown): v is AlertKind => typeof v === 'string' && (ALERT_KINDS as readonly string[]).includes(v);

/** A notice the user saved, with where it came from and when it was true. */
export interface NodeAlert {
  id: string;
  nodeId: string;
  tripId: string;
  kind: AlertKind;
  title: string;
  body: string;
  source: string;
  sourceUrl: string | null;
  /** Confirmed fact (e.g. from an official source) versus informational. */
  confirmed: boolean;
  status: 'saved' | 'dismissed';
  /** When the information was observed / last checked. */
  observedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertInput {
  kind: AlertKind;
  title: string;
  body?: string;
  source: string;
  sourceUrl?: string | null;
  confirmed?: boolean;
  observedAt?: string | null;
}

/** Days since a notice was checked; notices older than this are flagged as possibly out of date. */
export const ALERT_STALE_DAYS = 7;

export function alertAgeDays(alert: Pick<NodeAlert, 'observedAt' | 'createdAt'>, now: Date): number {
  const at = Date.parse(alert.observedAt ?? alert.createdAt);
  if (Number.isNaN(at)) return Infinity;
  return Math.floor((now.getTime() - at) / (24 * 60 * 60 * 1000));
}

export interface NodeMemory {
  nodeId: string;
  tripId: string;
  visitedOn: string | null;
  rating: number | null;
  notes: string;
  moments: string;
  photos: string[];
  createdAt: string;
  updatedAt: string;
}

export type MemoryPatch = Partial<Pick<NodeMemory, 'visitedOn' | 'rating' | 'notes' | 'moments' | 'photos'>>;

/* ------------------------------------------------------------------ */
/* Navigation list                                                     */
/* ------------------------------------------------------------------ */

/** A place in the Navigation list. Its nesting and order are its own. */
export interface NavItem extends TreeItem {
  tripId: string;
  nodeId: string;
  updatedAt: string;
}

/**
 * Where a newly added navigation item goes: under the nearest plan ancestor
 * that is already in the Navigation list, otherwise at the top level.
 */
export function navigationParentFor(
  planAncestors: readonly string[],
  navigation: readonly Pick<NavItem, 'id' | 'nodeId'>[],
): string | null {
  const byNode = new Map(navigation.map((item) => [item.nodeId, item.id]));
  for (const ancestor of planAncestors) {
    const found = byNode.get(ancestor);
    if (found) return found;
  }
  return null;
}
