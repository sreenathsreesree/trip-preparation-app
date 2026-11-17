import type { Database } from '@/db/types';

import type { ChecklistRepository } from '../preparation/checklistRepository';
import type { Priority } from '../preparation/model';
import type { PackingRepository } from './packingRepository';

/**
 * Unified Packing: everything packing lives in the packing tables. This adds
 * what was missing — item priority, safe category/group deletion (items are
 * moved, never lost), adopting the old Clothing organiser's categories as
 * Clothing groups, and resolving the old Packing checklist tasks one by one.
 *
 * Groups inside a packing category are that category's subcategories (the same
 * records Inventory uses), so there is no second grouping system.
 */

export class UnifiedPackingError extends Error {}

const PRIORITIES: readonly Priority[] = ['essential', 'recommended', 'optional'];

/** A task from the old Packing (or Clothing) checklist section that has not been resolved yet. */
export interface OldChecklistTask {
  taskId: string;
  sectionId: string;
  sectionTitle: string;
  /** True for the Clothing checklist section (its items go to the Clothing category). */
  fromClothingSection: boolean;
  title: string;
  description: string;
  notes: string;
  priority: Priority;
  isDone: boolean;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  quantity: number;
}

export type TaskDecision = 'kept' | 'converted' | 'removed';

const CLOTHING_TITLE_SQL = `(lower(s.title) LIKE '%cloth%' OR lower(s.title) LIKE '%wear%' OR lower(s.title) LIKE '%outfit%' OR lower(s.title) LIKE '%apparel%' OR lower(s.title) LIKE '%garment%')`;
/** Old packing-type checklist sections: the built-in Packing section and the Clothing section. */
const OLD_PACKING_SECTION_SQL = `(s.kind = 'packing' OR (s.kind = 'custom' AND ${CLOTHING_TITLE_SQL}))`;

export function createUnifiedPackingRepository(
  db: Database,
  deps: { packing: PackingRepository; checklists: ChecklistRepository; now?: () => string },
) {
  const stamp = () => deps.now?.() ?? new Date().toISOString();

  const categoryBySystemKey = async (key: string) =>
    (await db.getFirstAsync<{ id: string }>('SELECT id FROM inventory_categories WHERE system_key = ? AND parent_id IS NULL', [key]))?.id ?? null;

  const repo = {
    /* -------------------------------------------------------------- */
    /* Priority                                                        */
    /* -------------------------------------------------------------- */

    async priorities(tripId: string): Promise<Record<string, Priority>> {
      const rows = await db.getAllAsync<{ entry_id: string; priority: Priority | null }>(
        'SELECT m.entry_id, m.priority FROM packing_entry_meta m JOIN packing_entries e ON e.id = m.entry_id WHERE e.trip_id = ?',
        [tripId],
      );
      return Object.fromEntries(rows.filter((r) => r.priority).map((r) => [r.entry_id, r.priority as Priority]));
    },

    async setPriority(entryId: string, priority: Priority | null): Promise<void> {
      if (priority !== null && !PRIORITIES.includes(priority)) throw new UnifiedPackingError('Unknown priority.');
      const exists = await db.getFirstAsync<{ id: string }>('SELECT id FROM packing_entries WHERE id = ?', [entryId]);
      if (!exists) throw new UnifiedPackingError('That item is no longer on the list.');
      await db.runAsync(
        `INSERT INTO packing_entry_meta (entry_id, priority, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (entry_id) DO UPDATE SET priority = excluded.priority, updated_at = excluded.updated_at`,
        [entryId, priority, stamp()],
      );
    },

    /* -------------------------------------------------------------- */
    /* Clothing organiser → Clothing groups (repeat-safe)              */
    /* -------------------------------------------------------------- */

    /**
     * Each Clothing-organiser category holding items of this trip's Clothing category becomes a
     * Clothing group (a subcategory, reusing one with the same name), and those items move into
     * it. Ids derive from the name, so repeated runs and other devices never duplicate groups.
     * The organiser's own records are left as they are. Returns how many items moved.
     */
    async adoptClothingGroups(tripId: string): Promise<number> {
      const clothing = await categoryBySystemKey('clothing');
      if (!clothing) return 0;
      const pending = await db.getAllAsync<{ entry_id: string; name: string }>(
        `SELECT ci.entry_id, trim(cc.name) AS name FROM clothing_items ci
         JOIN clothing_categories cc ON cc.id = ci.category_id
         JOIN packing_entries e ON e.id = ci.entry_id
         WHERE ci.trip_id = ? AND e.category_id = ? AND trim(cc.name) <> ''`,
        [tripId, clothing],
      );
      if (pending.length === 0) return 0;
      let moved = 0;
      await db.withTransactionAsync(async () => {
        const t = stamp();
        for (const { entry_id, name } of pending) {
          let group = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM inventory_categories WHERE parent_id = ? AND lower(trim(name)) = lower(?) ORDER BY position LIMIT 1',
            [clothing, name],
          );
          if (!group) {
            const id = `clothing-group-${name.toLowerCase().replace(/\s+/g, '-')}`;
            const next = (await db.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM inventory_categories WHERE parent_id = ?', [clothing]))?.n ?? 0;
            await db.runAsync(
              `INSERT OR IGNORE INTO inventory_categories (id, parent_id, name, icon, color, position, cover_image_uri, system_key, created_at, updated_at)
               SELECT ?, id, ?, 'hanger', color, ?, NULL, NULL, ?, ? FROM inventory_categories WHERE id = ?`,
              [id, name.slice(0, 40), next, t, t, clothing],
            );
            group = { id };
          }
          const r = await db.runAsync('UPDATE packing_entries SET category_id = ?, updated_at = ? WHERE id = ? AND category_id = ?', [group.id, t, entry_id, clothing]);
          moved += r.changes;
        }
      });
      return moved;
    },

    /* -------------------------------------------------------------- */
    /* Safe category / group deletion                                  */
    /* -------------------------------------------------------------- */

    /**
     * Deletes a custom category or group after moving everything in it: packing items (every
     * trip) and Inventory items go to `moveTo` (another category, or for a group: another group
     * of the same category, or null = the category itself). Nothing is deleted except the
     * category record. Starter categories cannot be deleted.
     */
    async deleteCategoryMoving(categoryId: string, moveTo: string | null): Promise<void> {
      const category = await db.getFirstAsync<{ id: string; parent_id: string | null; system_key: string | null }>(
        'SELECT id, parent_id, system_key FROM inventory_categories WHERE id = ?',
        [categoryId],
      );
      if (!category) return;
      if (category.system_key) throw new UnifiedPackingError('Starter categories can be renamed or reordered, but not deleted.');
      if (moveTo === categoryId) throw new UnifiedPackingError('Choose a different category.');
      const target = moveTo ? await db.getFirstAsync<{ id: string; parent_id: string | null }>('SELECT id, parent_id FROM inventory_categories WHERE id = ?', [moveTo]) : null;
      if (moveTo && !target) throw new UnifiedPackingError('That category no longer exists.');
      const t = stamp();
      await db.withTransactionAsync(async () => {
        if (category.parent_id) {
          // A group: its items go to another group of the same category, or to the category itself.
          if (target && target.parent_id !== category.parent_id) throw new UnifiedPackingError('Choose a group of the same category.');
          await db.runAsync('UPDATE packing_entries SET category_id = ?, updated_at = ? WHERE category_id = ?', [moveTo ?? category.parent_id, t, categoryId]);
          await db.runAsync('UPDATE inventory_items SET subcategory_id = ?, updated_at = ? WHERE subcategory_id = ?', [moveTo, t, categoryId]);
        } else {
          if (!target || target.parent_id) throw new UnifiedPackingError('Choose another category for its items.');
          const children = (await db.getAllAsync<{ id: string }>('SELECT id FROM inventory_categories WHERE parent_id = ?', [categoryId])).map((r) => r.id);
          for (const id of [categoryId, ...children]) {
            await db.runAsync('UPDATE packing_entries SET category_id = ?, updated_at = ? WHERE category_id = ?', [moveTo, t, id]);
          }
          await db.runAsync('UPDATE inventory_items SET category_id = ?, subcategory_id = NULL, updated_at = ? WHERE category_id = ?', [moveTo, t, categoryId]);
        }
        await db.runAsync('DELETE FROM inventory_categories WHERE id = ?', [categoryId]);
      });
    },

    /* -------------------------------------------------------------- */
    /* Old Packing checklist tasks                                     */
    /* -------------------------------------------------------------- */

    /** Unresolved tasks of the trip's old Packing / Clothing checklist sections ("kept" ones are not listed). */
    async oldChecklistTasks(tripId: string): Promise<OldChecklistTask[]> {
      const rows = await db.getAllAsync<{
        id: string;
        section_id: string;
        section_title: string;
        kind: string;
        title: string;
        description: string;
        notes: string;
        priority: Priority;
        is_done: number;
        inventory_item_id: string | null;
        item_name: string | null;
        quantity: number | null;
      }>(
        `SELECT t.id, t.section_id, s.title AS section_title, s.kind, t.title, t.description, t.notes, t.priority, t.is_done,
                l.inventory_item_id, i.name AS item_name, l.quantity
         FROM checklist_tasks t
         JOIN checklist_sections s ON s.id = t.section_id
         LEFT JOIN checklist_task_links l ON l.task_id = t.id
         LEFT JOIN inventory_items i ON i.id = l.inventory_item_id
         LEFT JOIN checklist_task_resolutions r ON r.task_id = t.id
         WHERE s.trip_id = ? AND ${OLD_PACKING_SECTION_SQL} AND r.task_id IS NULL
         ORDER BY s.position, t.position`,
        [tripId],
      );
      return rows.map((r) => ({
        taskId: r.id,
        sectionId: r.section_id,
        sectionTitle: r.section_title,
        fromClothingSection: r.kind === 'custom',
        title: r.title,
        description: r.description ?? '',
        notes: r.notes ?? '',
        priority: r.priority,
        isDone: r.is_done === 1,
        inventoryItemId: r.inventory_item_id,
        inventoryItemName: r.item_name,
        quantity: r.quantity ?? 1,
      }));
    },

    async decision(taskId: string): Promise<{ decision: TaskDecision; packingEntryId: string | null } | null> {
      const row = await db.getFirstAsync<{ decision: TaskDecision; packing_entry_id: string | null }>('SELECT decision, packing_entry_id FROM checklist_task_resolutions WHERE task_id = ?', [taskId]);
      return row ? { decision: row.decision, packingEntryId: row.packing_entry_id } : null;
    },

    /** "Keep in checklist": the task stays where it is and is no longer offered for conversion. */
    async keepTask(tripId: string, taskId: string): Promise<void> {
      await db.runAsync(
        `INSERT INTO checklist_task_resolutions (task_id, trip_id, decision, packing_entry_id, decided_at) VALUES (?, ?, 'kept', NULL, ?)
         ON CONFLICT (task_id) DO NOTHING`,
        [taskId, tripId, stamp()],
      );
    },

    /**
     * "Move to packing list": creates the packing item (name, quantity, notes, Inventory link,
     * priority, packed state), checks it was saved, records the conversion, and only then removes
     * the checklist task. A task is converted at most once.
     */
    async convertTask(tripId: string, taskId: string): Promise<{ entryId: string }> {
      const previous = await repo.decision(taskId);
      if (previous?.decision === 'converted' && previous.packingEntryId) {
        // Finish an interrupted conversion: the item exists, so only the task is left to remove.
        const still = await db.getFirstAsync<{ id: string }>('SELECT id FROM packing_entries WHERE id = ?', [previous.packingEntryId]);
        if (still) {
          await deps.checklists.deleteTask(taskId).catch(() => undefined);
          return { entryId: previous.packingEntryId };
        }
      }
      if (previous && previous.decision !== 'converted') throw new UnifiedPackingError('This task was already resolved.');
      const task = (await repo.oldChecklistTasks(tripId)).find((t) => t.taskId === taskId);
      if (!task) throw new UnifiedPackingError('That task is no longer in the old packing checklist.');

      // Category: the linked Inventory item's category; the Clothing section's items go to Clothing; else Miscellaneous.
      const itemCategory = task.inventoryItemId
        ? (await db.getFirstAsync<{ category_id: string | null; subcategory_id: string | null }>('SELECT category_id, subcategory_id FROM inventory_items WHERE id = ?', [task.inventoryItemId]))
        : null;
      const categoryId =
        itemCategory?.subcategory_id ?? itemCategory?.category_id ?? (task.fromClothingSection ? await categoryBySystemKey('clothing') : await categoryBySystemKey('misc'));
      const notes = [task.description, task.notes].map((s) => s.trim()).filter(Boolean).join('\n').slice(0, 300);
      const entry = await deps.packing.addEntry(tripId, {
        name: task.title.slice(0, 80),
        quantity: Math.max(1, Math.min(99, task.quantity)),
        categoryId,
        inventoryItemId: task.inventoryItemId,
        notes,
        source: task.inventoryItemId ? 'inventory' : 'manual',
      });
      // Verify before touching the task.
      const saved = await db.getFirstAsync<{ id: string; name: string }>('SELECT id, name FROM packing_entries WHERE id = ? AND trip_id = ?', [entry.id, tripId]);
      if (!saved) throw new UnifiedPackingError('The packing item could not be saved; the checklist task was kept.');
      await repo.setPriority(entry.id, task.priority);
      if (task.isDone) await db.runAsync('UPDATE packing_entries SET is_packed = 1, updated_at = ? WHERE id = ?', [stamp(), entry.id]);
      await db.runAsync(
        `INSERT INTO checklist_task_resolutions (task_id, trip_id, decision, packing_entry_id, decided_at) VALUES (?, ?, 'converted', ?, ?)
         ON CONFLICT (task_id) DO UPDATE SET decision = 'converted', packing_entry_id = excluded.packing_entry_id, decided_at = excluded.decided_at`,
        [taskId, tripId, entry.id, stamp()],
      );
      await deps.checklists.deleteTask(taskId);
      return { entryId: entry.id };
    },

    /**
     * Template packing sections (approved by the user) become packing items instead of checklist
     * tasks: Clothing-type sections go to Clothing, others to Miscellaneous. An item whose name is
     * already on the trip's packing list is skipped, so applying a template twice adds nothing twice.
     */
    async addTemplateItems(
      tripId: string,
      items: readonly { title: string; priority: Priority; description?: string; notes?: string; clothing: boolean }[],
    ): Promise<{ added: number; skipped: number }> {
      const existing = new Set(
        (await db.getAllAsync<{ name: string }>('SELECT name FROM packing_entries WHERE trip_id = ?', [tripId])).map((r) => r.name.trim().toLowerCase()),
      );
      const clothing = await categoryBySystemKey('clothing');
      const misc = await categoryBySystemKey('misc');
      let added = 0;
      let skipped = 0;
      for (const item of items) {
        const name = item.title.trim().slice(0, 80);
        const key = name.toLowerCase();
        if (!name || existing.has(key)) {
          skipped += 1;
          continue;
        }
        const notes = [item.description ?? '', item.notes ?? ''].map((x) => x.trim()).filter(Boolean).join('\n').slice(0, 300);
        const entry = await deps.packing.addEntry(tripId, { name, quantity: 1, categoryId: item.clothing ? clothing : misc, inventoryItemId: null, notes, source: 'manual' });
        await repo.setPriority(entry.id, item.priority);
        existing.add(key);
        added += 1;
      }
      return { added, skipped };
    },

    /** "Remove from trip": deletes the checklist task only (a linked Inventory item is never touched). */
    async removeTask(tripId: string, taskId: string): Promise<void> {
      const previous = await repo.decision(taskId);
      if (previous && previous.decision !== 'removed') throw new UnifiedPackingError('This task was already resolved.');
      await db.runAsync(
        `INSERT INTO checklist_task_resolutions (task_id, trip_id, decision, packing_entry_id, decided_at) VALUES (?, ?, 'removed', NULL, ?)
         ON CONFLICT (task_id) DO NOTHING`,
        [taskId, tripId, stamp()],
      );
      await deps.checklists.deleteTask(taskId);
    },
  };
  return repo;
}

export type UnifiedPackingRepository = ReturnType<typeof createUnifiedPackingRepository>;
