import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import {
  isPrepSectionId,
  normalizeItemTitle,
  PREP_ITEM_TITLE_MAX,
  type PrepItem,
  type PrepSectionId,
} from './model';

interface PrepItemRow {
  id: string;
  trip_id: string;
  section: string;
  title: string;
  is_done: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapItem(row: PrepItemRow): PrepItem | null {
  // Rows from a future section type are skipped rather than crashing older builds.
  if (!isPrepSectionId(row.section)) return null;
  return {
    id: row.id,
    tripId: row.trip_id,
    section: row.section,
    title: row.title,
    isDone: row.is_done === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PrepItemRepository {
  listByTrip(tripId: string): Promise<PrepItem[]>;
  add(tripId: string, section: PrepSectionId, title: string): Promise<PrepItem>;
  setDone(id: string, isDone: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  countAll(): Promise<number>;
}

export function createPrepItemRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): PrepItemRepository {
  const now = deps.now ?? (() => new Date());

  return {
    async listByTrip(tripId) {
      const rows = await db.getAllAsync<PrepItemRow>(
        `SELECT * FROM prep_items WHERE trip_id = ? ORDER BY section ASC, position ASC, created_at ASC`,
        [tripId],
      );
      return rows.map(mapItem).filter((item): item is PrepItem => item !== null);
    },

    async add(tripId, section, rawTitle) {
      const title = normalizeItemTitle(rawTitle);
      if (title.length === 0) {
        throw new Error('Item name cannot be empty.');
      }
      if (title.length > PREP_ITEM_TITLE_MAX) {
        throw new Error(`Keep item names under ${PREP_ITEM_TITLE_MAX} characters.`);
      }

      const id = deps.createId();
      const timestamp = now().toISOString();
      const next = await db.getFirstAsync<{ next: number }>(
        'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM prep_items WHERE trip_id = ? AND section = ?',
        [tripId, section],
      );
      const position = next?.next ?? 0;

      await db.runAsync(
        `INSERT INTO prep_items (id, trip_id, section, title, is_done, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, tripId, section, title, position, timestamp, timestamp],
      );

      return {
        id,
        tripId,
        section,
        title,
        isDone: false,
        position,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async setDone(id, isDone) {
      const result = await db.runAsync(
        'UPDATE prep_items SET is_done = ?, updated_at = ? WHERE id = ?',
        [isDone ? 1 : 0, now().toISOString(), id],
      );
      if (result.changes === 0) {
        throw new Error('That item no longer exists.');
      }
    },

    async remove(id) {
      await db.runAsync('DELETE FROM prep_items WHERE id = ?', [id]);
    },

    async countAll() {
      const row = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM prep_items',
        [],
      );
      return row?.count ?? 0;
    },
  };
}
