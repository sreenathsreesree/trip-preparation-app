import type { Database } from '@/db/types';

import type { ChecklistRepository } from './checklistRepository';
import { emptyTaskDraft, type SectionKind } from './model';

export interface ChecklistGroup {
  id: string;
  sectionId: string;
  title: string;
  position: number;
}

export interface TaskLink {
  groupId: string | null;
  inventoryItemId: string | null;
  quantity: number;
}

export const GROUP_LIMITS = { titleMax: 40, groupsPerSection: 30 } as const;

export class SectionExtrasError extends Error {}

/**
 * Which checklist sections can hold Inventory items: packing lists and the
 * user's own sections (Clothing, Gear, Toiletries…). Not documents, vehicle
 * checks, errands, shopping (things not owned yet) or home departure.
 */
export function supportsInventory(kind: SectionKind, title?: string | null): boolean {
  if (kind === 'packing') return true;
  if (kind !== 'custom') return false;
  // A user's own section about paperwork, the vehicle, errands or buying things is not for things they own.
  return !(title && NOT_OWNED_TITLE.test(title));
}

const NOT_OWNED_TITLE = /\b(documents?|papers|passports?|visas?|tickets?|bookings?|vehicles?|errands?|shopping|to buy|purchases?)\b/i;

/** A user's clothing section ("Clothing", "Clothes", "Outfits", "Wear"…). */
export const CLOTHING_TITLE = /cloth|wear|outfit|apparel|garment/i;
export const CLOTHING_SECTION_TITLE = 'Clothing';

export function isClothingSection(section: { kind: SectionKind; title: string }): boolean {
  return section.kind === 'custom' && CLOTHING_TITLE.test(section.title);
}

/**
 * A checklist section that held packing items before Packing became its own list: the built-in
 * Packing section and the Clothing section. Its remaining tasks are resolved from Packing; it is
 * shown only while it still has tasks.
 */
export function isOldPackingSection(section: { kind: SectionKind; title: string }): boolean {
  return section.kind === 'packing' || isClothingSection(section);
}

/** The trip's clothing section: one named exactly "Clothing" first, else any clothing-like custom section. */
export function findClothingSection<S extends { kind: SectionKind; title: string; position: number }>(sections: readonly S[]): S | null {
  const own = sections.filter(isClothingSection).sort((a, b) => a.position - b.position);
  return own.find((s) => s.title.trim().toLowerCase() === CLOTHING_SECTION_TITLE.toLowerCase()) ?? own[0] ?? null;
}

export function validateGroupTitle(title: string, existing: readonly Pick<ChecklistGroup, 'id' | 'title'>[], selfId?: string): string | null {
  const value = title.trim();
  if (!value) return 'Give the group a name.';
  if (value.length > GROUP_LIMITS.titleMax) return `Keep it under ${GROUP_LIMITS.titleMax} characters.`;
  if (existing.some((g) => g.id !== selfId && g.title.trim().toLowerCase() === value.toLowerCase())) return 'There is already a group with that name.';
  return null;
}

/**
 * Groups inside checklist sections and Inventory links on tasks. Tasks are
 * created and edited through the checklist repository as before; this only
 * adds the group and the Inventory item a task stands for. Nothing here ever
 * deletes an Inventory item.
 */
export function createSectionExtrasRepository(db: Database, deps: { createId: () => string; checklists: ChecklistRepository; now?: () => string }) {
  const stamp = () => deps.now?.() ?? new Date().toISOString();

  async function groups(sectionId: string): Promise<ChecklistGroup[]> {
    const rows = await db.getAllAsync<{ id: string; section_id: string; title: string; position: number }>(
      'SELECT id, section_id, title, position FROM checklist_groups WHERE section_id = ? ORDER BY position, created_at',
      [sectionId],
    );
    return rows.map((r) => ({ id: r.id, sectionId: r.section_id, title: r.title, position: r.position }));
  }

  async function sectionOfTask(taskId: string) {
    return (await db.getFirstAsync<{ section_id: string }>('SELECT section_id FROM checklist_tasks WHERE id = ?', [taskId]))?.section_id ?? null;
  }

  async function setLink(taskId: string, patch: Partial<TaskLink>) {
    const current = await db.getFirstAsync<{ group_id: string | null; inventory_item_id: string | null; quantity: number }>('SELECT group_id, inventory_item_id, quantity FROM checklist_task_links WHERE task_id = ?', [taskId]);
    const next = {
      groupId: patch.groupId !== undefined ? patch.groupId : (current?.group_id ?? null),
      inventoryItemId: patch.inventoryItemId !== undefined ? patch.inventoryItemId : (current?.inventory_item_id ?? null),
      quantity: patch.quantity ?? current?.quantity ?? 1,
    };
    await db.runAsync(
      `INSERT INTO checklist_task_links (task_id, group_id, inventory_item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET group_id = excluded.group_id, inventory_item_id = excluded.inventory_item_id, quantity = excluded.quantity, updated_at = excluded.updated_at`,
      [taskId, next.groupId, next.inventoryItemId, Math.max(1, Math.min(99, Math.round(next.quantity))), stamp()],
    );
  }

  return {
    groups,

    /** Group, Inventory item and quantity for every task of the section that has any. */
    async links(sectionId: string): Promise<Record<string, TaskLink>> {
      const rows = await db.getAllAsync<{ task_id: string; group_id: string | null; inventory_item_id: string | null; quantity: number }>(
        `SELECT l.task_id, l.group_id, l.inventory_item_id, l.quantity FROM checklist_task_links l
         JOIN checklist_tasks t ON t.id = l.task_id WHERE t.section_id = ?`,
        [sectionId],
      );
      return Object.fromEntries(rows.map((r) => [r.task_id, { groupId: r.group_id, inventoryItemId: r.inventory_item_id, quantity: r.quantity }]));
    },

    async addGroup(sectionId: string, title: string): Promise<ChecklistGroup> {
      const existing = await groups(sectionId);
      if (existing.length >= GROUP_LIMITS.groupsPerSection) throw new SectionExtrasError('This section has the most groups it can hold.');
      const error = validateGroupTitle(title, existing);
      if (error) throw new SectionExtrasError(error);
      const id = deps.createId();
      const t = stamp();
      const position = existing.length ? Math.max(...existing.map((g) => g.position)) + 1 : 0;
      await db.runAsync('INSERT INTO checklist_groups (id, section_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, sectionId, title.trim(), position, t, t]);
      return { id, sectionId, title: title.trim(), position };
    },

    async renameGroup(id: string, title: string): Promise<void> {
      const row = await db.getFirstAsync<{ section_id: string }>('SELECT section_id FROM checklist_groups WHERE id = ?', [id]);
      if (!row) throw new SectionExtrasError('That group no longer exists.');
      const error = validateGroupTitle(title, await groups(row.section_id), id);
      if (error) throw new SectionExtrasError(error);
      await db.runAsync('UPDATE checklist_groups SET title = ?, updated_at = ? WHERE id = ?', [title.trim(), stamp(), id]);
    },

    /** Deletes a group; its tasks move to `moveTo` (another group of the section) or out of any group. Tasks are never deleted. */
    async deleteGroup(id: string, moveTo: string | null): Promise<void> {
      await db.withTransactionAsync(async () => {
        const row = await db.getFirstAsync<{ section_id: string }>('SELECT section_id FROM checklist_groups WHERE id = ?', [id]);
        if (!row) return;
        if (moveTo) {
          const target = await db.getFirstAsync<{ id: string }>('SELECT id FROM checklist_groups WHERE id = ? AND section_id = ?', [moveTo, row.section_id]);
          if (!target || moveTo === id) throw new SectionExtrasError('Choose another group of this section.');
        }
        await db.runAsync('UPDATE checklist_task_links SET group_id = ?, updated_at = ? WHERE group_id = ?', [moveTo, stamp(), id]);
        await db.runAsync('DELETE FROM checklist_groups WHERE id = ?', [id]);
      });
    },

    /**
     * Before a task moves to another section: the name of its Inventory item when that
     * item is already linked there (it would be listed twice), else null.
     */
    async linkConflict(taskId: string, targetSectionId: string): Promise<string | null> {
      const row = await db.getFirstAsync<{ name: string }>(
        `SELECT i.name FROM checklist_task_links l JOIN inventory_items i ON i.id = l.inventory_item_id
         WHERE l.task_id = ? AND EXISTS (
           SELECT 1 FROM checklist_task_links o JOIN checklist_tasks t ON t.id = o.task_id
           WHERE t.section_id = ? AND o.task_id <> l.task_id AND o.inventory_item_id = l.inventory_item_id)`,
        [taskId, targetSectionId],
      );
      return row?.name ?? null;
    },

    /** The task's link (group, Inventory item and its name, quantity), or null. */
    async taskLink(taskId: string): Promise<(TaskLink & { inventoryItemName: string | null }) | null> {
      const row = await db.getFirstAsync<{ group_id: string | null; inventory_item_id: string | null; quantity: number; name: string | null }>(
        'SELECT l.group_id, l.inventory_item_id, l.quantity, i.name FROM checklist_task_links l LEFT JOIN inventory_items i ON i.id = l.inventory_item_id WHERE l.task_id = ?',
        [taskId],
      );
      return row ? { groupId: row.group_id, inventoryItemId: row.inventory_item_id, quantity: row.quantity, inventoryItemName: row.name } : null;
    },

    async setTaskGroup(taskId: string, groupId: string | null): Promise<void> {
      const sectionId = await sectionOfTask(taskId);
      if (!sectionId) throw new SectionExtrasError('That task no longer exists.');
      if (groupId) {
        const g = await db.getFirstAsync<{ section_id: string }>('SELECT section_id FROM checklist_groups WHERE id = ?', [groupId]);
        if (!g || g.section_id !== sectionId) throw new SectionExtrasError('Choose a group of the same section.');
      }
      await setLink(taskId, { groupId });
    },

    async setQuantity(taskId: string, quantity: number): Promise<void> {
      await setLink(taskId, { quantity });
    },

    /** Adds a task by hand into a group (or none). */
    async addManual(sectionId: string, groupId: string | null, title: string, priority: Parameters<typeof emptyTaskDraft>[0]) {
      const task = await deps.checklists.addTask(sectionId, { ...emptyTaskDraft(priority), title });
      if (groupId) await setLink(task.id, { groupId });
      return task;
    },

    /**
     * Adds Inventory items as tasks of a section, each linked to its original
     * Inventory record (nothing is copied into Inventory). Items already
     * linked in this section are skipped, not added twice.
     */
    async addFromInventory(sectionId: string, groupId: string | null, items: readonly { itemId: string; quantity?: number }[]): Promise<{ added: number; skipped: number }> {
      const section = await db.getFirstAsync<{ kind: SectionKind; title: string }>('SELECT kind, title FROM checklist_sections WHERE id = ?', [sectionId]);
      if (!section) throw new SectionExtrasError('That section no longer exists.');
      if (!supportsInventory(section.kind, section.title)) throw new SectionExtrasError('Inventory items can’t be added to this section.');
      if (groupId) {
        const g = await db.getFirstAsync<{ section_id: string }>('SELECT section_id FROM checklist_groups WHERE id = ?', [groupId]);
        if (!g || g.section_id !== sectionId) throw new SectionExtrasError('Choose a group of this section.');
      }
      const linked = new Set(
        (
          await db.getAllAsync<{ inventory_item_id: string }>(
            `SELECT l.inventory_item_id FROM checklist_task_links l JOIN checklist_tasks t ON t.id = l.task_id
             WHERE t.section_id = ? AND l.inventory_item_id IS NOT NULL`,
            [sectionId],
          )
        ).map((r) => r.inventory_item_id),
      );
      let added = 0;
      let skipped = 0;
      for (const { itemId, quantity } of items) {
        if (linked.has(itemId)) {
          skipped++;
          continue;
        }
        const item = await db.getFirstAsync<{ name: string; archived_at: string | null }>('SELECT name, archived_at FROM inventory_items WHERE id = ?', [itemId]);
        if (!item) {
          skipped++;
          continue;
        }
        const task = await deps.checklists.addTask(sectionId, { ...emptyTaskDraft('recommended'), title: item.name.slice(0, 120) });
        await setLink(task.id, { groupId, inventoryItemId: itemId, quantity: quantity ?? 1 });
        linked.add(itemId);
        added++;
      }
      return { added, skipped };
    },
  };
}

export type SectionExtrasRepository = ReturnType<typeof createSectionExtrasRepository>;
