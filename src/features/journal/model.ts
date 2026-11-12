import type { IconName } from '@/theme/icons';

/**
 * Journey Journal domain (pure). Entries are the user's own writing; nothing
 * here is generated.
 */

export const MOODS = ['great', 'good', 'okay', 'tired', 'bad'] as const;
export type Mood = (typeof MOODS)[number];
export const MOOD_META: Record<Mood, { label: string; icon: IconName }> = {
  great: { label: 'Great', icon: 'emoticon-excited-outline' },
  good: { label: 'Good', icon: 'emoticon-happy-outline' },
  okay: { label: 'Okay', icon: 'emoticon-neutral-outline' },
  tired: { label: 'Tired', icon: 'emoticon-sick-outline' },
  bad: { label: 'Rough', icon: 'emoticon-sad-outline' },
};
export const isMood = (v: unknown): v is Mood => typeof v === 'string' && (MOODS as readonly string[]).includes(v);

export type Visibility = 'private' | 'shared';

export const JOURNAL_LIMITS = { titleMax: 120, bodyMax: 20000, captionMax: 200, photosMax: 30 } as const;

export interface JournalPhoto {
  id: string;
  entryId: string;
  uri: string;
  caption: string;
  position: number;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  tripId: string;
  nodeId: string | null;
  entryDate: string;
  title: string;
  body: string;
  mood: Mood | null;
  visibility: Visibility;
  photos: JournalPhoto[];
  createdAt: string;
  updatedAt: string;
}

export interface EntryInput {
  entryDate: string;
  title?: string;
  body?: string;
  mood?: Mood | null;
  nodeId?: string | null;
}

export const isIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Returns an error message, or null when the input can be saved. */
export function validateEntry(input: EntryInput): string | null {
  if (!isIsoDate(input.entryDate)) return 'Choose a valid date (YYYY-MM-DD).';
  const title = input.title?.trim() ?? '';
  const body = input.body?.trim() ?? '';
  if (!title && !body) return 'Write a title or a few words.';
  if (title.length > JOURNAL_LIMITS.titleMax) return `Keep the title under ${JOURNAL_LIMITS.titleMax} characters.`;
  if (body.length > JOURNAL_LIMITS.bodyMax) return `Keep the entry under ${JOURNAL_LIMITS.bodyMax} characters.`;
  if (input.mood != null && !isMood(input.mood)) return 'Choose a mood from the list.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

/** A destination memory (from the destination page) shown in the journal. */
export interface MemoryItem {
  nodeId: string;
  nodeName: string;
  visitedOn: string;
  rating: number | null;
  notes: string;
  photos: string[];
}

export type TimelineItem = { kind: 'entry'; entry: JournalEntry } | { kind: 'memory'; memory: MemoryItem };

export interface TimelineDay {
  date: string;
  /** "Day 2" within the trip, or null before/after it. */
  dayNumber: number | null;
  items: TimelineItem[];
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Groups entries and dated memories by day, newest day first; within a day,
 * memories first, then entries in the order they were written.
 */
export function buildTimeline(
  entries: readonly JournalEntry[],
  memories: readonly MemoryItem[],
  trip: { startDate: string; endDate: string },
): TimelineDay[] {
  const days = new Map<string, TimelineItem[]>();
  const push = (date: string, item: TimelineItem) => days.set(date, [...(days.get(date) ?? []), item]);
  for (const memory of memories) if (isIsoDate(memory.visitedOn)) push(memory.visitedOn, { kind: 'memory', memory });
  for (const entry of [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) push(entry.entryDate, { kind: 'entry', entry });
  const span = daysBetween(trip.startDate, trip.endDate);
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => {
      const n = daysBetween(trip.startDate, date);
      return {
        date,
        dayNumber: n >= 0 && n <= span ? n + 1 : null,
        items: [...items.filter((i) => i.kind === 'memory'), ...items.filter((i) => i.kind === 'entry')],
      };
    });
}

/** Default date for a new entry: today during the trip, else the nearest trip day. */
export function defaultEntryDate(trip: { startDate: string; endDate: string }, today: string): string {
  if (today < trip.startDate) return trip.startDate;
  if (today > trip.endDate) return trip.endDate;
  return today;
}

/* ------------------------------------------------------------------ */
/* Backup format (Google Drive)                                        */
/* ------------------------------------------------------------------ */

export const BACKUP_FORMAT = 'tripprep-journal';
export const BACKUP_VERSION = 1;

export interface BackupPhoto {
  id: string;
  caption: string;
  position: number;
  /** File name of the photo in the trip's Drive folder. */
  fileName: string;
}

export interface BackupEntry {
  id: string;
  nodeId: string | null;
  entryDate: string;
  title: string;
  body: string;
  mood: Mood | null;
  createdAt: string;
  updatedAt: string;
  photos: BackupPhoto[];
}

export interface JournalBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  tripId: string;
  tripName: string;
  exportedAt: string;
  entries: BackupEntry[];
}

export const photoFileName = (photo: Pick<JournalPhoto, 'id' | 'uri'>) => {
  const ext = /^data:image\/(png|webp|jpeg)/.exec(photo.uri)?.[1] ?? /\.(jpe?g|png|webp|heic)$/i.exec(photo.uri)?.[1]?.toLowerCase() ?? 'jpg';
  return `photo-${photo.id}.${ext === 'jpeg' ? 'jpg' : ext}`;
};

/** The journal as written to Drive. Visibility is not included: the backup is the owner's own copy. */
export function toBackup(trip: { id: string; name: string }, entries: readonly JournalEntry[], exportedAt: string): JournalBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tripId: trip.id,
    tripName: trip.name,
    exportedAt,
    entries: entries.map((e) => ({
      id: e.id,
      nodeId: e.nodeId,
      entryDate: e.entryDate,
      title: e.title,
      body: e.body,
      mood: e.mood,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      photos: e.photos.map((p) => ({ id: p.id, caption: p.caption, position: p.position, fileName: photoFileName(p) })),
    })),
  };
}

/** Reads a backup file defensively; returns null for anything that is not a journal backup. */
export function parseBackup(raw: unknown): JournalBackup | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<JournalBackup>;
  if (b.format !== BACKUP_FORMAT || typeof b.version !== 'number' || b.version > BACKUP_VERSION) return null;
  if (typeof b.tripId !== 'string' || !Array.isArray(b.entries)) return null;
  const entries: BackupEntry[] = [];
  for (const e of b.entries as Partial<BackupEntry>[]) {
    if (!e || typeof e.id !== 'string' || typeof e.entryDate !== 'string' || !isIsoDate(e.entryDate)) continue;
    entries.push({
      id: e.id,
      nodeId: typeof e.nodeId === 'string' ? e.nodeId : null,
      entryDate: e.entryDate,
      title: String(e.title ?? '').slice(0, JOURNAL_LIMITS.titleMax),
      body: String(e.body ?? '').slice(0, JOURNAL_LIMITS.bodyMax),
      mood: isMood(e.mood) ? e.mood : null,
      createdAt: String(e.createdAt ?? ''),
      updatedAt: String(e.updatedAt ?? ''),
      photos: (Array.isArray(e.photos) ? e.photos : [])
        .filter((p): p is BackupPhoto => !!p && typeof p.id === 'string' && typeof p.fileName === 'string')
        .map((p) => ({ id: p.id, caption: String(p.caption ?? '').slice(0, JOURNAL_LIMITS.captionMax), position: Number(p.position) || 0, fileName: p.fileName })),
    });
  }
  return { format: BACKUP_FORMAT, version: b.version, tripId: b.tripId, tripName: String(b.tripName ?? ''), exportedAt: String(b.exportedAt ?? ''), entries };
}

export interface RestorePlan {
  /** Entries missing on this device: added. */
  add: BackupEntry[];
  /** Photos missing from entries that exist on both sides: added. */
  addPhotos: { entryId: string; photo: BackupPhoto }[];
  /** Same entry, different text on each side: the device copy is kept. */
  conflicts: BackupEntry[];
  unchanged: number;
}

const sameText = (a: Pick<BackupEntry, 'entryDate' | 'title' | 'body' | 'mood'>, b: Pick<BackupEntry, 'entryDate' | 'title' | 'body' | 'mood'>) =>
  a.entryDate === b.entryDate && a.title === b.title && a.body === b.body && a.mood === b.mood;

/** Additive restore: never deletes or overwrites anything on the device. */
export function planRestore(local: readonly JournalEntry[], backup: JournalBackup): RestorePlan {
  const byId = new Map(local.map((e) => [e.id, e]));
  const plan: RestorePlan = { add: [], addPhotos: [], conflicts: [], unchanged: 0 };
  for (const entry of backup.entries) {
    const mine = byId.get(entry.id);
    if (!mine) {
      plan.add.push(entry);
      continue;
    }
    const have = new Set(mine.photos.map((p) => p.id));
    for (const photo of entry.photos) if (!have.has(photo.id)) plan.addPhotos.push({ entryId: entry.id, photo });
    if (sameText(mine, entry)) plan.unchanged += 1;
    else plan.conflicts.push(entry);
  }
  return plan;
}
