import type { Migration } from '../migrate';

/**
 * Checklist sections get their own groups (sub-sections such as "Tops" and
 * "Footwear" inside Clothing) and can link tasks to Inventory items.
 * Additive only: new tables; checklist tasks themselves are not changed.
 *
 * - `checklist_groups`: groups inside one section.
 * - `checklist_task_links`: a task's group and, optionally, the Inventory
 *   item it stands for (with a quantity). Deleting a task, group or section
 *   removes only the link; the Inventory item is never deleted from here
 *   (deleting the item clears the link instead).
 *
 * Both stay on this device (see sync/tables.ts).
 */
export const checklistGroupsInventory: Migration = {
  version: 15,
  name: 'checklist_groups_inventory',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE checklist_groups (
        id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL REFERENCES checklist_sections (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_checklist_groups_section ON checklist_groups (section_id, position);

      CREATE TABLE checklist_task_links (
        task_id TEXT PRIMARY KEY NOT NULL REFERENCES checklist_tasks (id) ON DELETE CASCADE,
        group_id TEXT REFERENCES checklist_groups (id) ON DELETE SET NULL,
        inventory_item_id TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_checklist_task_links_group ON checklist_task_links (group_id);
      CREATE INDEX idx_checklist_task_links_item ON checklist_task_links (inventory_item_id);
    `);
  },
};
