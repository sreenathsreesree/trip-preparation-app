import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { normalizeName } from '../inventory/model';
import {
  cleanTags,
  COMPANION_LIMITS,
  emptyProfile,
  isAlertKind,
  isBestTime,
  isNoteKind,
  isTaskCategory,
  navigationParentFor,
  type AlertInput,
  type MemoryPatch,
  type NavItem,
  type NodeAlert,
  type NodeMemory,
  type NodeNote,
  type NodeProfile,
  type NodeTask,
  type NoteKind,
  type ProfilePatch,
  type TaskCategory,
} from './companion';
import { cleanArrivalSettings, type ArrivalSettings } from './arrival';
import { ancestorIds, canMove, childrenOf, PLANNER_LIMITS } from './model';
import { PlannerError } from './plannerRepository';

/* ------------------------------------------------------------------ */
/* Rows and mapping                                                    */
/* ------------------------------------------------------------------ */

interface ProfileRow {
  node_id: string;
  trip_id: string;
  visit_status: string;
  visited_at: string | null;
  saved: number;
  cover_image_uri: string | null;
  tags: string;
  about: string;
  best_season: string;
  entry_fee: string;
  travel_info: string;
  visit_minutes: number | null;
  best_time: string;
  created_at: string;
  updated_at: string;
}

interface NavRow {
  id: string;
  trip_id: string;
  node_id: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  trip_id: string;
  node_id: string;
  category: string;
  title: string;
  notes: string;
  is_done: number;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  trip_id: string;
  node_id: string;
  kind: string;
  body: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface AlertRow {
  id: string;
  trip_id: string;
  node_id: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  source_url: string | null;
  confirmed: number;
  status: string;
  observed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  node_id: string;
  trip_id: string;
  visited_on: string | null;
  rating: number | null;
  notes: string;
  moments: string;
  photos: string;
  created_at: string;
  updated_at: string;
}

function parseList(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function mapProfile(row: ProfileRow): NodeProfile {
  return {
    nodeId: row.node_id,
    tripId: row.trip_id,
    visitStatus: row.visit_status === 'visited' ? 'visited' : 'upcoming',
    visitedAt: row.visited_at,
    saved: row.saved === 1,
    coverImageUri: row.cover_image_uri,
    tags: parseList(row.tags),
    about: row.about,
    bestSeason: row.best_season,
    entryFee: row.entry_fee,
    travelInfo: row.travel_info,
    visitMinutes: row.visit_minutes,
    bestTime: isBestTime(row.best_time) ? row.best_time : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const mapNav = (row: NavRow): NavItem => ({
  id: row.id,
  tripId: row.trip_id,
  nodeId: row.node_id,
  parentId: row.parent_id,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapTask = (row: TaskRow): NodeTask => ({
  id: row.id,
  nodeId: row.node_id,
  tripId: row.trip_id,
  category: isTaskCategory(row.category) ? row.category : 'other',
  title: row.title,
  notes: row.notes,
  isDone: row.is_done === 1,
  position: row.position,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapNote = (row: NoteRow): NodeNote => ({
  id: row.id,
  nodeId: row.node_id,
  tripId: row.trip_id,
  kind: isNoteKind(row.kind) ? row.kind : 'other',
  body: row.body,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAlert = (row: AlertRow): NodeAlert => ({
  id: row.id,
  nodeId: row.node_id,
  tripId: row.trip_id,
  kind: isAlertKind(row.kind) ? row.kind : 'info',
  title: row.title,
  body: row.body,
  source: row.source,
  sourceUrl: row.source_url,
  confirmed: row.confirmed === 1,
  status: row.status === 'dismissed' ? 'dismissed' : 'saved',
  observedAt: row.observed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemory = (row: MemoryRow): NodeMemory => ({
  nodeId: row.node_id,
  tripId: row.trip_id,
  visitedOn: row.visited_on,
  rating: row.rating,
  notes: row.notes,
  moments: row.moments,
  photos: parseList(row.photos),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function cleanText(value: string, max: number, label: string): string {
  const clean = value.trim();
  if (clean.length > max) throw new PlannerError(`Keep ${label} under ${max} characters.`);
  return clean;
}

function cleanTitle(value: string, label = 'the title'): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean) throw new PlannerError('Give it a title.');
  if (clean.length > COMPANION_LIMITS.titleMax) throw new PlannerError(`Keep ${label} under ${COMPANION_LIMITS.titleMax} characters.`);
  return clean;
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface NodeDetails {
  profile: NodeProfile;
  tasks: NodeTask[];
  notes: NodeNote[];
  alerts: NodeAlert[];
  memory: NodeMemory | null;
}

export interface TripCompanion {
  /** Profiles of places that have one (others use `emptyProfile`). */
  profiles: NodeProfile[];
  navigation: NavItem[];
  /** Preparation progress per place. */
  taskCounts: Record<string, { done: number; total: number }>;
  /** The first Memories photo of each place that has one (the user's own photo, shown before automatic covers). */
  memoryPhotos?: Record<string, string>;
}

export interface CompanionRepository {
  trip(tripId: string): Promise<TripCompanion>;
  node(nodeId: string): Promise<NodeDetails>;
  updateProfile(nodeId: string, patch: ProfilePatch): Promise<NodeProfile>;
  /** Only ever called from an explicit user action (button or confirmed arrival prompt). */
  setVisited(nodeId: string, visited: boolean): Promise<NodeProfile>;
  addTask(nodeId: string, input: { title: string; category?: TaskCategory; notes?: string }): Promise<NodeTask>;
  /** Adds several tasks, skipping titles the place already has. Returns how many were added. */
  addTasks(nodeId: string, inputs: readonly { title: string; category: TaskCategory }[]): Promise<number>;
  updateTask(id: string, patch: { title?: string; notes?: string; category?: TaskCategory; isDone?: boolean }): Promise<NodeTask>;
  removeTask(id: string): Promise<void>;
  addNote(nodeId: string, input: { kind: NoteKind; body: string }): Promise<NodeNote>;
  updateNote(id: string, patch: { kind?: NoteKind; body?: string }): Promise<NodeNote>;
  removeNote(id: string): Promise<void>;
  addAlert(nodeId: string, input: AlertInput): Promise<NodeAlert>;
  setAlertStatus(id: string, status: 'saved' | 'dismissed'): Promise<NodeAlert>;
  removeAlert(id: string): Promise<void>;
  saveMemory(nodeId: string, patch: MemoryPatch): Promise<NodeMemory>;
  /** Adds a place to the Navigation list (never twice). */
  addToNavigation(tripId: string, nodeId: string): Promise<{ status: 'added' | 'duplicate'; item: NavItem }>;
  /** Removes it from Navigation only; places inside it move up a level. Plan and route are untouched. */
  removeFromNavigation(itemId: string): Promise<void>;
  /** Reorders / nests / promotes within the Navigation list only. */
  moveNavigation(itemId: string, target: { parentId: string | null; index?: number }): Promise<void>;
  /** Arrival prompt settings (on this device; off by default). */
  arrivalSettings(): Promise<ArrivalSettings>;
  saveArrivalSettings(settings: ArrivalSettings): Promise<ArrivalSettings>;
}

const ARRIVAL_KEY = 'arrival_prompts';

export function createCompanionRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): CompanionRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function tripOf(nodeId: string): Promise<string> {
    const row = await db.getFirstAsync<{ trip_id: string }>('SELECT trip_id FROM trip_plan_nodes WHERE id = ?', [nodeId]);
    if (!row) throw new PlannerError('That place is no longer in this plan.');
    return row.trip_id;
  }

  async function profileRow(nodeId: string) {
    return db.getFirstAsync<ProfileRow>('SELECT * FROM plan_node_profiles WHERE node_id = ?', [nodeId]);
  }

  /** Creates the profile row on first change. */
  async function ensureProfile(nodeId: string, timestamp: string): Promise<void> {
    const tripId = await tripOf(nodeId);
    await db.runAsync(
      `INSERT OR IGNORE INTO plan_node_profiles (node_id, trip_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [nodeId, tripId, timestamp, timestamp],
    );
  }

  async function getProfile(nodeId: string): Promise<NodeProfile> {
    const row = await profileRow(nodeId);
    return row ? mapProfile(row) : emptyProfile(nodeId, await tripOf(nodeId));
  }

  async function nextPosition(table: string, nodeId: string): Promise<number> {
    const row = await db.getFirstAsync<{ next: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM ${table} WHERE node_id = ?`,
      [nodeId],
    );
    return row?.next ?? 0;
  }

  async function navRows(tripId: string): Promise<NavItem[]> {
    return (await db.getAllAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE trip_id = ?', [tripId])).map(mapNav);
  }

  async function writeNavOrder(ids: readonly string[], parentId: string | null, timestamp: string) {
    for (let position = 0; position < ids.length; position += 1) {
      await db.runAsync('UPDATE trip_navigation_items SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?', [
        parentId,
        position,
        timestamp,
        ids[position] ?? '',
      ]);
    }
  }

  async function mustTask(id: string) {
    const row = await db.getFirstAsync<TaskRow>('SELECT * FROM plan_node_tasks WHERE id = ?', [id]);
    if (!row) throw new PlannerError('That task no longer exists.');
    return row;
  }

  return {
    async trip(tripId) {
      const [profiles, navigation, counts, memories] = await Promise.all([
        db.getAllAsync<ProfileRow>('SELECT * FROM plan_node_profiles WHERE trip_id = ?', [tripId]),
        navRows(tripId),
        db.getAllAsync<{ node_id: string; done: number; total: number }>(
          `SELECT node_id, SUM(is_done) AS done, COUNT(*) AS total FROM plan_node_tasks WHERE trip_id = ? GROUP BY node_id`,
          [tripId],
        ),
        db.getAllAsync<{ node_id: string; photos: string }>('SELECT node_id, photos FROM plan_node_memories WHERE trip_id = ?', [tripId]),
      ]);
      const memoryPhotos: Record<string, string> = {};
      for (const m of memories) {
        try {
          const list: unknown = JSON.parse(m.photos);
          const first = Array.isArray(list) ? list.find((u): u is string => typeof u === 'string' && u.length > 0) : undefined;
          if (first) memoryPhotos[m.node_id] = first;
        } catch {
          // Unreadable list: no photo for this place.
        }
      }
      return {
        profiles: profiles.map(mapProfile),
        navigation,
        taskCounts: Object.fromEntries(counts.map((c) => [c.node_id, { done: c.done ?? 0, total: c.total }])),
        memoryPhotos,
      };
    },

    async node(nodeId) {
      const [profile, tasks, notes, alerts, memory] = await Promise.all([
        getProfile(nodeId),
        db.getAllAsync<TaskRow>('SELECT * FROM plan_node_tasks WHERE node_id = ? ORDER BY position, created_at', [nodeId]),
        db.getAllAsync<NoteRow>('SELECT * FROM plan_node_notes WHERE node_id = ? ORDER BY position, created_at', [nodeId]),
        db.getAllAsync<AlertRow>('SELECT * FROM plan_node_alerts WHERE node_id = ? ORDER BY created_at DESC', [nodeId]),
        db.getFirstAsync<MemoryRow>('SELECT * FROM plan_node_memories WHERE node_id = ?', [nodeId]),
      ]);
      return {
        profile,
        tasks: tasks.map(mapTask),
        notes: notes.map(mapNote),
        alerts: alerts.map(mapAlert),
        memory: memory ? mapMemory(memory) : null,
      };
    },

    async updateProfile(nodeId, patch) {
      const current = await getProfile(nodeId);
      const next = { ...current, ...patch };
      if (next.visitMinutes !== null && (!Number.isInteger(next.visitMinutes) || next.visitMinutes < 0 || next.visitMinutes > COMPANION_LIMITS.visitMinutesMax)) {
        throw new PlannerError('Choose a visit length between 0 minutes and 7 days.');
      }
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await ensureProfile(nodeId, timestamp);
        await db.runAsync(
          `UPDATE plan_node_profiles SET saved = ?, cover_image_uri = ?, tags = ?, about = ?, best_season = ?, entry_fee = ?,
                  travel_info = ?, visit_minutes = ?, best_time = ?, updated_at = ? WHERE node_id = ?`,
          [
            next.saved ? 1 : 0,
            next.coverImageUri,
            JSON.stringify(cleanTags(next.tags)),
            cleanText(next.about, COMPANION_LIMITS.textMax, 'the description'),
            cleanText(next.bestSeason, COMPANION_LIMITS.shortMax, 'the best season'),
            cleanText(next.entryFee, COMPANION_LIMITS.shortMax, 'the entry fee'),
            cleanText(next.travelInfo, COMPANION_LIMITS.textMax, 'the travel information'),
            next.visitMinutes,
            next.bestTime ?? '',
            timestamp,
            nodeId,
          ],
        );
      });
      return getProfile(nodeId);
    },

    async setVisited(nodeId, visited) {
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await ensureProfile(nodeId, timestamp);
        await db.runAsync(
          `UPDATE plan_node_profiles SET visit_status = ?, visited_at = ?, updated_at = ? WHERE node_id = ?`,
          [visited ? 'visited' : 'upcoming', visited ? timestamp : null, timestamp, nodeId],
        );
      });
      return getProfile(nodeId);
    },

    async addTask(nodeId, input) {
      const tripId = await tripOf(nodeId);
      const id = deps.createId();
      const timestamp = stamp();
      await db.runAsync(
        `INSERT INTO plan_node_tasks (id, trip_id, node_id, category, title, notes, is_done, position, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
        [
          id,
          tripId,
          nodeId,
          input.category && isTaskCategory(input.category) ? input.category : 'other',
          cleanTitle(input.title, 'the task'),
          cleanText(input.notes ?? '', COMPANION_LIMITS.textMax, 'the notes'),
          await nextPosition('plan_node_tasks', nodeId),
          timestamp,
          timestamp,
        ],
      );
      return mapTask(await mustTask(id));
    },

    async addTasks(nodeId, inputs) {
      const tripId = await tripOf(nodeId);
      const timestamp = stamp();
      let added = 0;
      await db.withTransactionAsync(async () => {
        const existing = new Set(
          (await db.getAllAsync<{ title: string }>('SELECT title FROM plan_node_tasks WHERE node_id = ?', [nodeId])).map((r) =>
            normalizeName(r.title),
          ),
        );
        let position = await nextPosition('plan_node_tasks', nodeId);
        for (const input of inputs) {
          const title = cleanTitle(input.title, 'the task');
          if (existing.has(normalizeName(title))) continue;
          existing.add(normalizeName(title));
          await db.runAsync(
            `INSERT INTO plan_node_tasks (id, trip_id, node_id, category, title, notes, is_done, position, completed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, '', 0, ?, NULL, ?, ?)`,
            [deps.createId(), tripId, nodeId, isTaskCategory(input.category) ? input.category : 'other', title, position, timestamp, timestamp],
          );
          position += 1;
          added += 1;
        }
      });
      return added;
    },

    async updateTask(id, patch) {
      const row = await mustTask(id);
      const timestamp = stamp();
      const isDone = patch.isDone !== undefined ? patch.isDone : row.is_done === 1;
      await db.runAsync(
        `UPDATE plan_node_tasks SET title = ?, notes = ?, category = ?, is_done = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [
          patch.title !== undefined ? cleanTitle(patch.title, 'the task') : row.title,
          patch.notes !== undefined ? cleanText(patch.notes, COMPANION_LIMITS.textMax, 'the notes') : row.notes,
          patch.category !== undefined && isTaskCategory(patch.category) ? patch.category : row.category,
          isDone ? 1 : 0,
          isDone ? (row.completed_at ?? timestamp) : null,
          timestamp,
          id,
        ],
      );
      return mapTask(await mustTask(id));
    },

    async removeTask(id) {
      await db.runAsync('DELETE FROM plan_node_tasks WHERE id = ?', [id]);
    },

    async addNote(nodeId, input) {
      const tripId = await tripOf(nodeId);
      const body = cleanText(input.body, COMPANION_LIMITS.textMax, 'the note');
      if (!body) throw new PlannerError('Write something first.');
      const id = deps.createId();
      const timestamp = stamp();
      await db.runAsync(
        `INSERT INTO plan_node_notes (id, trip_id, node_id, kind, body, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tripId, nodeId, isNoteKind(input.kind) ? input.kind : 'other', body, await nextPosition('plan_node_notes', nodeId), timestamp, timestamp],
      );
      const row = await db.getFirstAsync<NoteRow>('SELECT * FROM plan_node_notes WHERE id = ?', [id]);
      return mapNote(row as NoteRow);
    },

    async updateNote(id, patch) {
      const row = await db.getFirstAsync<NoteRow>('SELECT * FROM plan_node_notes WHERE id = ?', [id]);
      if (!row) throw new PlannerError('That note no longer exists.');
      const body = patch.body !== undefined ? cleanText(patch.body, COMPANION_LIMITS.textMax, 'the note') : row.body;
      if (!body) throw new PlannerError('A note cannot be empty. Remove it instead.');
      await db.runAsync('UPDATE plan_node_notes SET kind = ?, body = ?, updated_at = ? WHERE id = ?', [
        patch.kind !== undefined && isNoteKind(patch.kind) ? patch.kind : row.kind,
        body,
        stamp(),
        id,
      ]);
      return mapNote((await db.getFirstAsync<NoteRow>('SELECT * FROM plan_node_notes WHERE id = ?', [id])) as NoteRow);
    },

    async removeNote(id) {
      await db.runAsync('DELETE FROM plan_node_notes WHERE id = ?', [id]);
    },

    async addAlert(nodeId, input) {
      const tripId = await tripOf(nodeId);
      const source = cleanText(input.source, COMPANION_LIMITS.shortMax, 'the source');
      if (!source) throw new PlannerError('Say where this information comes from.');
      const sourceUrl = input.sourceUrl?.trim() || null;
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new PlannerError('Links must start with http:// or https://.');
      const observedAt = input.observedAt ?? null;
      if (observedAt && Number.isNaN(Date.parse(observedAt))) throw new PlannerError('Choose a valid date.');
      const id = deps.createId();
      const timestamp = stamp();
      await db.runAsync(
        `INSERT INTO plan_node_alerts (id, trip_id, node_id, kind, title, body, source, source_url, confirmed, status, observed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?, ?, ?)`,
        [
          id,
          tripId,
          nodeId,
          isAlertKind(input.kind) ? input.kind : 'info',
          cleanTitle(input.title, 'the title'),
          cleanText(input.body ?? '', COMPANION_LIMITS.textMax, 'the details'),
          source,
          sourceUrl,
          input.confirmed ? 1 : 0,
          observedAt ?? timestamp,
          timestamp,
          timestamp,
        ],
      );
      return mapAlert((await db.getFirstAsync<AlertRow>('SELECT * FROM plan_node_alerts WHERE id = ?', [id])) as AlertRow);
    },

    async setAlertStatus(id, status) {
      await db.runAsync('UPDATE plan_node_alerts SET status = ?, updated_at = ? WHERE id = ?', [status, stamp(), id]);
      const row = await db.getFirstAsync<AlertRow>('SELECT * FROM plan_node_alerts WHERE id = ?', [id]);
      if (!row) throw new PlannerError('That notice no longer exists.');
      return mapAlert(row);
    },

    async removeAlert(id) {
      await db.runAsync('DELETE FROM plan_node_alerts WHERE id = ?', [id]);
    },

    async saveMemory(nodeId, patch) {
      const tripId = await tripOf(nodeId);
      const row = await db.getFirstAsync<MemoryRow>('SELECT * FROM plan_node_memories WHERE node_id = ?', [nodeId]);
      const current = row ? mapMemory(row) : null;
      const visitedOn = patch.visitedOn !== undefined ? patch.visitedOn : (current?.visitedOn ?? null);
      if (visitedOn && !isIsoDate(visitedOn)) throw new PlannerError('Choose a valid visit date.');
      const rating = patch.rating !== undefined ? patch.rating : (current?.rating ?? null);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new PlannerError('Rate it from 1 to 5.');
      const photos = (patch.photos ?? current?.photos ?? []).slice(0, COMPANION_LIMITS.photosMax);
      const timestamp = stamp();
      await db.runAsync(
        `INSERT INTO plan_node_memories (node_id, trip_id, visited_on, rating, notes, moments, photos, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (node_id) DO UPDATE SET visited_on = excluded.visited_on, rating = excluded.rating, notes = excluded.notes,
           moments = excluded.moments, photos = excluded.photos, updated_at = excluded.updated_at`,
        [
          nodeId,
          tripId,
          visitedOn,
          rating,
          cleanText(patch.notes ?? current?.notes ?? '', COMPANION_LIMITS.textMax, 'the notes'),
          cleanText(patch.moments ?? current?.moments ?? '', COMPANION_LIMITS.textMax, 'the moments'),
          JSON.stringify(photos),
          current?.createdAt ?? timestamp,
          timestamp,
        ],
      );
      return mapMemory((await db.getFirstAsync<MemoryRow>('SELECT * FROM plan_node_memories WHERE node_id = ?', [nodeId])) as MemoryRow);
    },

    async addToNavigation(tripId, nodeId) {
      if ((await tripOf(nodeId)) !== tripId) throw new PlannerError('That place belongs to another trip.');
      const existing = await db.getFirstAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE trip_id = ? AND node_id = ?', [
        tripId,
        nodeId,
      ]);
      if (existing) return { status: 'duplicate', item: mapNav(existing) };
      const timestamp = stamp();
      const id = deps.createId();
      await db.withTransactionAsync(async () => {
        const planNodes = await db.getAllAsync<{ id: string; parent_id: string | null; position: number; created_at: string }>(
          'SELECT id, parent_id, position, created_at FROM trip_plan_nodes WHERE trip_id = ?',
          [tripId],
        );
        const tree = planNodes.map((n) => ({ id: n.id, parentId: n.parent_id, position: n.position, createdAt: n.created_at }));
        const navigation = await navRows(tripId);
        const parentId = navigationParentFor(ancestorIds(tree, nodeId), navigation);
        const siblings = childrenOf(navigation, parentId);
        await db.runAsync(
          `INSERT INTO trip_navigation_items (id, trip_id, node_id, parent_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, tripId, nodeId, parentId, siblings.length, timestamp, timestamp],
        );
      });
      const row = await db.getFirstAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE id = ?', [id]);
      return { status: 'added', item: mapNav(row as NavRow) };
    },

    async removeFromNavigation(itemId) {
      const row = await db.getFirstAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE id = ?', [itemId]);
      if (!row) return;
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const items = await navRows(row.trip_id);
        // Places inside take its spot, in their order.
        const siblings = childrenOf(items, row.parent_id).map((i) => i.id);
        const at = siblings.indexOf(itemId);
        const children = childrenOf(items, itemId).map((i) => i.id);
        siblings.splice(at === -1 ? siblings.length : at, 1, ...children);
        await writeNavOrder(siblings, row.parent_id, timestamp);
        await db.runAsync('DELETE FROM trip_navigation_items WHERE id = ?', [itemId]);
      });
    },

    async arrivalSettings() {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM user_preferences WHERE key = ?', [ARRIVAL_KEY]);
      try {
        return cleanArrivalSettings(row ? JSON.parse(row.value) : null);
      } catch {
        return cleanArrivalSettings(null);
      }
    },

    async saveArrivalSettings(settings) {
      const clean = cleanArrivalSettings(settings);
      await db.runAsync(
        `INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [ARRIVAL_KEY, JSON.stringify(clean), stamp()],
      );
      return clean;
    },

    async moveNavigation(itemId, target) {
      const row = await db.getFirstAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE id = ?', [itemId]);
      if (!row) throw new PlannerError('That place is no longer in Navigation.');
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const items = await navRows(row.trip_id);
        if (target.parentId && !items.some((i) => i.id === target.parentId)) {
          throw new PlannerError('That folder is no longer in Navigation.');
        }
        const check = canMove(items, itemId, target.parentId);
        if (!check.ok) throw new PlannerError(check.reason);
        const oldSiblings = childrenOf(items, row.parent_id).filter((i) => i.id !== itemId).map((i) => i.id);
        const newSiblings =
          target.parentId === row.parent_id ? oldSiblings : childrenOf(items, target.parentId).map((i) => i.id).filter((x) => x !== itemId);
        const index = Math.max(0, Math.min(target.index ?? newSiblings.length, newSiblings.length));
        newSiblings.splice(index, 0, itemId);
        if (target.parentId !== row.parent_id) await writeNavOrder(oldSiblings, row.parent_id, timestamp);
        await writeNavOrder(newSiblings, target.parentId, timestamp);
      });
    },
  };
}

/**
 * Copies a trip's companion data into a duplicated trip: profiles (as
 * upcoming — visits are not copied), preparation tasks (not done), notes and
 * the Navigation list. Saved notices and memories belong to the original trip.
 */
export async function copyCompanion(
  db: Database,
  createId: IdFactory,
  nodeMap: ReadonlyMap<string, string>,
  fromTripId: string,
  toTripId: string,
  timestamp: string,
) {
  const profiles = await db.getAllAsync<ProfileRow>('SELECT * FROM plan_node_profiles WHERE trip_id = ?', [fromTripId]);
  for (const p of profiles) {
    const nodeId = nodeMap.get(p.node_id);
    if (!nodeId) continue;
    await db.runAsync(
      `INSERT INTO plan_node_profiles (node_id, trip_id, visit_status, visited_at, saved, cover_image_uri, tags, about, best_season,
         entry_fee, travel_info, visit_minutes, best_time, created_at, updated_at)
       VALUES (?, ?, 'upcoming', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, toTripId, p.saved, p.cover_image_uri, p.tags, p.about, p.best_season, p.entry_fee, p.travel_info, p.visit_minutes, p.best_time, timestamp, timestamp],
    );
  }
  const tasks = await db.getAllAsync<TaskRow>('SELECT * FROM plan_node_tasks WHERE trip_id = ?', [fromTripId]);
  for (const t of tasks) {
    const nodeId = nodeMap.get(t.node_id);
    if (!nodeId) continue;
    await db.runAsync(
      `INSERT INTO plan_node_tasks (id, trip_id, node_id, category, title, notes, is_done, position, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
      [createId(), toTripId, nodeId, t.category, t.title, t.notes, t.position, timestamp, timestamp],
    );
  }
  const notes = await db.getAllAsync<NoteRow>('SELECT * FROM plan_node_notes WHERE trip_id = ?', [fromTripId]);
  for (const n of notes) {
    const nodeId = nodeMap.get(n.node_id);
    if (!nodeId) continue;
    await db.runAsync(
      `INSERT INTO plan_node_notes (id, trip_id, node_id, kind, body, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [createId(), toTripId, nodeId, n.kind, n.body, n.position, timestamp, timestamp],
    );
  }
  const nav = await db.getAllAsync<NavRow>('SELECT * FROM trip_navigation_items WHERE trip_id = ?', [fromTripId]);
  const navMap = new Map(nav.map((item) => [item.id, createId()]));
  const ordered: NavRow[] = [];
  const pending = [...nav];
  while (pending.length > 0) {
    const index = pending.findIndex((item) => !item.parent_id || ordered.some((o) => o.id === item.parent_id));
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    if (next) ordered.push(next);
  }
  for (const item of ordered) {
    const nodeId = nodeMap.get(item.node_id);
    if (!nodeId) continue;
    await db.runAsync(
      `INSERT INTO trip_navigation_items (id, trip_id, node_id, parent_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [navMap.get(item.id) ?? createId(), toTripId, nodeId, item.parent_id ? (navMap.get(item.parent_id) ?? null) : null, item.position, timestamp, timestamp],
    );
  }
}

/** Depth limit shared with the destination hierarchy. */
export const NAVIGATION_MAX_DEPTH = PLANNER_LIMITS.maxDepth;
