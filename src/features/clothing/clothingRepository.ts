import type { Database } from '@/db/types';
import type { IconName } from '@/theme/icons';

import { CLOTHING_LIMITS, STARTER_CATEGORIES, validateCategoryName, type ClothingCategory } from './model';

interface CategoryRow {
  id: string;
  trip_id: string;
  name: string;
  icon: string;
  position: number;
}

const toCategory = (r: CategoryRow): ClothingCategory => ({ id: r.id, tripId: r.trip_id, name: r.name, icon: r.icon as IconName, position: r.position });

export class ClothingError extends Error {}

/**
 * The trip's clothing organizer. Clothing items are ordinary packing entries
 * (so packed state, bags, inventory links and packing progress all keep
 * working); this repository only keeps the trip's clothing categories and
 * which entry belongs to which. All of it stays on this device.
 */
export function createClothingRepository(db: Database, deps: { createId: () => string; now?: () => string }) {
  const stamp = () => deps.now?.() ?? new Date().toISOString();

  async function categories(tripId: string): Promise<ClothingCategory[]> {
    const rows = await db.getAllAsync<CategoryRow>('SELECT * FROM clothing_categories WHERE trip_id = ? ORDER BY position, created_at', [tripId]);
    return rows.map(toCategory);
  }

  return {
    categories,

    /** Creates the starter categories once, when the trip has none and no clothing items yet. */
    async ensureStarter(tripId: string): Promise<boolean> {
      let created = false;
      await db.withTransactionAsync(async () => {
        const has = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM clothing_categories WHERE trip_id = ?', [tripId]);
        const items = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM clothing_items WHERE trip_id = ?', [tripId]);
        if ((has?.n ?? 0) > 0 || (items?.n ?? 0) > 0) return;
        const t = stamp();
        let position = 0;
        for (const c of STARTER_CATEGORIES) {
          await db.runAsync('INSERT INTO clothing_categories (id, trip_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [deps.createId(), tripId, c.name, c.icon, position++, t, t]);
        }
        created = true;
      });
      return created;
    },

    async links(tripId: string): Promise<Record<string, string | null>> {
      const rows = await db.getAllAsync<{ entry_id: string; category_id: string | null }>('SELECT entry_id, category_id FROM clothing_items WHERE trip_id = ?', [tripId]);
      return Object.fromEntries(rows.map((r) => [r.entry_id, r.category_id]));
    },

    async addCategory(tripId: string, input: { name: string; icon: IconName }): Promise<ClothingCategory> {
      const existing = await categories(tripId);
      if (existing.length >= CLOTHING_LIMITS.categoriesMax) throw new ClothingError('This trip already has the most categories it can hold.');
      const error = validateCategoryName(input.name, existing);
      if (error) throw new ClothingError(error);
      const id = deps.createId();
      const t = stamp();
      const position = existing.length ? Math.max(...existing.map((c) => c.position)) + 1 : 0;
      await db.runAsync('INSERT INTO clothing_categories (id, trip_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, tripId, input.name.trim(), input.icon, position, t, t]);
      return { id, tripId, name: input.name.trim(), icon: input.icon, position };
    },

    async updateCategory(id: string, input: { name: string; icon: IconName }): Promise<void> {
      const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM clothing_categories WHERE id = ?', [id]);
      if (!row) throw new ClothingError('That category no longer exists.');
      const error = validateCategoryName(input.name, await categories(row.trip_id), id);
      if (error) throw new ClothingError(error);
      await db.runAsync('UPDATE clothing_categories SET name = ?, icon = ?, updated_at = ? WHERE id = ?', [input.name.trim(), input.icon, stamp(), id]);
    },

    /**
     * Deletes a category. Its items are never lost silently: they move to
     * `moveTo` (another category of the same trip) or, with null, stay on the
     * packing list without a category.
     */
    async removeCategory(id: string, moveTo: string | null): Promise<void> {
      await db.withTransactionAsync(async () => {
        const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM clothing_categories WHERE id = ?', [id]);
        if (!row) return;
        if (moveTo) {
          const target = await db.getFirstAsync<CategoryRow>('SELECT * FROM clothing_categories WHERE id = ? AND trip_id = ?', [moveTo, row.trip_id]);
          if (!target || target.id === id) throw new ClothingError('Choose another category of this trip.');
        }
        await db.runAsync('UPDATE clothing_items SET category_id = ? WHERE category_id = ?', [moveTo, id]);
        await db.runAsync('DELETE FROM clothing_categories WHERE id = ?', [id]);
      });
    },

    /** Marks a packing entry of the trip as clothing in a category (or moves it). */
    async link(tripId: string, entryId: string, categoryId: string | null): Promise<void> {
      const entry = await db.getFirstAsync<{ trip_id: string }>('SELECT trip_id FROM packing_entries WHERE id = ?', [entryId]);
      if (!entry || entry.trip_id !== tripId) throw new ClothingError('That item is not on this trip’s packing list.');
      await db.runAsync(
        `INSERT INTO clothing_items (entry_id, trip_id, category_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (entry_id) DO UPDATE SET category_id = excluded.category_id`,
        [entryId, tripId, categoryId, stamp()],
      );
    },

    /** Stops treating an entry as clothing; the packing entry itself is kept. */
    async unlink(entryId: string): Promise<void> {
      await db.runAsync('DELETE FROM clothing_items WHERE entry_id = ?', [entryId]);
    },
  };
}

export type ClothingRepository = ReturnType<typeof createClothingRepository>;
