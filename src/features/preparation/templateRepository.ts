import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { copyName } from '../trips/model';
import { ChecklistError, copyChecklist, loadChecklist } from './checklistRepository';
import {
  CHECKLIST_LIMITS,
  normalizeTitle,
  templateOwner,
  tripOwner,
  type ChecklistPlan,
} from './model';

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSummary extends ChecklistTemplate {
  sectionCount: number;
  taskCount: number;
}

export interface TemplateInput {
  name: string;
  description: string;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  section_count?: number;
  task_count?: number;
}

function mapTemplate(row: TemplateRow): TemplateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sectionCount: Number(row.section_count) || 0,
    taskCount: Number(row.task_count) || 0,
  };
}

export function validateTemplateInput(input: TemplateInput): Partial<Record<keyof TemplateInput, string>> {
  const errors: Partial<Record<keyof TemplateInput, string>> = {};
  const name = normalizeTitle(input.name);
  if (name.length === 0) errors.name = 'Give the template a name.';
  else if (name.length > CHECKLIST_LIMITS.templateNameMax)
    errors.name = `Keep it under ${CHECKLIST_LIMITS.templateNameMax} characters.`;
  if (input.description.trim().length > CHECKLIST_LIMITS.templateDescriptionMax)
    errors.description = `Keep it under ${CHECKLIST_LIMITS.templateDescriptionMax} characters.`;
  return errors;
}

function cleanInput(input: TemplateInput): TemplateInput {
  const first = Object.values(validateTemplateInput(input))[0];
  if (first) throw new ChecklistError(first);
  return { name: normalizeTitle(input.name), description: input.description.trim() };
}

const SUMMARY_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM checklist_sections s WHERE s.template_id = c.id) AS section_count,
         (SELECT COUNT(*) FROM checklist_tasks t
            JOIN checklist_sections s ON s.id = t.section_id
           WHERE s.template_id = c.id) AS task_count
  FROM checklist_templates c
`;

export interface TemplateRepository {
  list(): Promise<TemplateSummary[]>;
  getById(id: string): Promise<TemplateSummary | null>;
  create(input: TemplateInput): Promise<TemplateSummary>;
  update(id: string, input: TemplateInput): Promise<TemplateSummary>;
  duplicate(id: string): Promise<TemplateSummary>;
  /** Deletes the template only; trips that used it keep their own copies. */
  remove(id: string): Promise<boolean>;
  /** Saves a trip's current checklist (structure and details, not completion) as a new template. */
  createFromTrip(tripId: string, input: TemplateInput): Promise<TemplateSummary>;
  /** The template as a plan whose tasks record where they came from. */
  toPlan(id: string): Promise<ChecklistPlan>;
}

export function createTemplateRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): TemplateRepository {
  const now = deps.now ?? (() => new Date());

  async function getById(id: string) {
    const row = await db.getFirstAsync<TemplateRow>(`${SUMMARY_SELECT} WHERE c.id = ?`, [id]);
    return row ? mapTemplate(row) : null;
  }

  async function mustGet(id: string) {
    const template = await getById(id);
    if (!template) throw new ChecklistError('That template no longer exists.');
    return template;
  }

  async function insertTemplate(input: TemplateInput, timestamp: string) {
    const id = deps.createId();
    await db.runAsync(
      `INSERT INTO checklist_templates (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, input.name, input.description, timestamp, timestamp],
    );
    return id;
  }

  return {
    async list() {
      const rows = await db.getAllAsync<TemplateRow>(
        `${SUMMARY_SELECT} ORDER BY c.name COLLATE NOCASE ASC, c.created_at ASC`,
        [],
      );
      return rows.map(mapTemplate);
    },

    getById,

    async create(input) {
      const clean = cleanInput(input);
      const id = await insertTemplate(clean, now().toISOString());
      return mustGet(id);
    },

    async update(id, input) {
      const clean = cleanInput(input);
      const result = await db.runAsync(
        'UPDATE checklist_templates SET name = ?, description = ?, updated_at = ? WHERE id = ?',
        [clean.name, clean.description, now().toISOString(), id],
      );
      if (result.changes === 0) throw new ChecklistError('That template no longer exists.');
      return mustGet(id);
    },

    async duplicate(id) {
      const source = await mustGet(id);
      const timestamp = now().toISOString();
      let copyId = '';
      await db.withTransactionAsync(async () => {
        copyId = await insertTemplate(
          { name: copyName(source.name, CHECKLIST_LIMITS.templateNameMax), description: source.description },
          timestamp,
        );
        await copyChecklist(db, templateOwner(id), templateOwner(copyId), { createId: deps.createId, timestamp }, {
          keepProvenance: false,
        });
      });
      return mustGet(copyId);
    },

    async remove(id) {
      const result = await db.runAsync('DELETE FROM checklist_templates WHERE id = ?', [id]);
      return result.changes > 0;
    },

    async createFromTrip(tripId, input) {
      const clean = cleanInput(input);
      const trip = await db.getFirstAsync<{ id: string }>('SELECT id FROM trips WHERE id = ?', [tripId]);
      if (!trip) throw new ChecklistError('That trip no longer exists.');
      const timestamp = now().toISOString();
      let id = '';
      await db.withTransactionAsync(async () => {
        id = await insertTemplate(clean, timestamp);
        await copyChecklist(db, tripOwner(tripId), templateOwner(id), { createId: deps.createId, timestamp }, {
          keepProvenance: false,
        });
      });
      return mustGet(id);
    },

    async toPlan(id) {
      await mustGet(id);
      const { sections, tasks } = await loadChecklist(db, templateOwner(id));
      return {
        sections: sections.map((section) => ({
          title: section.title,
          kind: section.kind,
          tasks: tasks
            .filter((task) => task.sectionId === section.id)
            .map((task) => ({
              title: task.title,
              description: task.description,
              notes: task.notes,
              priority: task.priority,
              sourceTemplateId: id,
              sourceTaskId: task.id,
            })),
        })),
      };
    },
  };
}
