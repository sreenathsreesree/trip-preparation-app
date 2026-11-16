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
export function supportsInventory(kind: SectionKind): boolean {
  return kind === 'packing' || kind === 'custom';
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
