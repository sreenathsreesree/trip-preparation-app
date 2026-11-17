import type { Migration } from '../migrate';

/**
 * Checklist section settings (Unified Checklist, phase 2). Additive only.
 *
 * `checklist_section_settings`: per section, an icon, a short description, whether the section
 * holds physical items (which decides whether Add from Inventory is offered — metadata instead
 * of guessing from the title), and the Inventory category it was created from. A section without
 * a row keeps the previous defaults. Deleting the section removes its settings; deleting the
 * Inventory category only clears the reference.
 *
 * Stays on this device (see sync/tables.ts).
 */
export const checklistSectionSettings: Migration = {
  version: 18,
  name: 'checklist_section_settings',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE checklist_section_settings (
        section_id TEXT PRIMARY KEY NOT NULL REFERENCES checklist_sections (id) ON DELETE CASCADE,
        icon TEXT,
        description TEXT NOT NULL DEFAULT '',
        holds_items INTEGER CHECK (holds_items IS NULL OR holds_items IN (0, 1)),
        inventory_category_id TEXT REFERENCES inventory_categories (id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_section_settings_category ON checklist_section_settings (inventory_category_id);
    `);
  },
};
