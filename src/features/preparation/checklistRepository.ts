import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import {
  CHECKLIST_LIMITS,
  normalizeTitle,
  parsePriority,
  parseSectionKind,
  planMerge,
  templateOwner,
  tripOwner,
  validateTaskDraft,
  type Checklist,
  type ChecklistOwner,
  type ChecklistPlan,
  type ChecklistSection,
  type ChecklistTask,
  type SectionKind,
  type TaskDraft,
} from './model';

interface SectionRow {
  id: string;
  trip_id: string | null;
  template_id: string | null;
  title: string;
  kind: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  section_id: string;
  title: string;
  description: string;
  notes: string;
  priority: string;
  is_done: number;
  position: number;
  source_template_id: string | null;
  source_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapSection(row: SectionRow): ChecklistSection {
  return {
    id: row.id,
    owner: row.trip_id ? tripOwner(row.trip_id) : templateOwner(row.template_id ?? ''),
    title: row.title,
    kind: parseSectionKind(row.kind),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskRow): ChecklistTask {
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    priority: parsePriority(row.priority),
    isDone: row.is_done === 1,
    position: row.position,
    sourceTemplateId: row.source_template_id,
    sourceTaskId: row.source_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Column that links a section to its owner. Fixed allowlist, safe to interpolate. */
const ownerColumn = (owner: ChecklistOwner) => (owner.type === 'trip' ? 'trip_id' : 'template_id');

const ORDER = 'ORDER BY position ASC, created_at ASC';

export class ChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecklistError';
  }
}

function cleanSectionTitle(title: string): string {
  const clean = normalizeTitle(title);
  if (clean.length === 0) throw new ChecklistError('Give the section a name.');
  if (clean.length > CHECKLIST_LIMITS.sectionTitleMax) {
    throw new ChecklistError(`Keep section names under ${CHECKLIST_LIMITS.sectionTitleMax} characters.`);
  }
  return clean;
}

function cleanTaskDraft(draft: TaskDraft): TaskDraft {
  const errors = validateTaskDraft(draft);
  const first = Object.values(errors)[0];
  if (first) throw new ChecklistError(first);
  return {
    title: normalizeTitle(draft.title),
    description: draft.description.trim(),
    notes: draft.notes.trim(),
    priority: draft.priority,
  };
}

export async function loadChecklist(db: Database, owner: ChecklistOwner): Promise<Checklist> {
  const column = ownerColumn(owner);
  const sections = await db.getAllAsync<SectionRow>(
    `SELECT * FROM checklist_sections WHERE ${column} = ? ${ORDER}`,
    [owner.id],
  );
  const tasks = await db.getAllAsync<TaskRow>(
    `SELECT t.* FROM checklist_tasks t
     JOIN checklist_sections s ON s.id = t.section_id
     WHERE s.${column} = ?
     ORDER BY s.position ASC, s.created_at ASC, t.position ASC, t.created_at ASC`,
    [owner.id],
  );
  return { sections: sections.map(mapSection), tasks: tasks.map(mapTask) };
}

interface PlanDeps {
  createId: IdFactory;
  timestamp: string;
}

/**
 * Merges a plan into an owner's checklist (see `planMerge`): existing tasks are
 * never changed, new tasks are appended, unknown sections are created at the
 * end. Must run inside the caller's transaction.
 */
export async function insertPlan(
  db: Database,
  owner: ChecklistOwner,
  plan: ChecklistPlan,
  { createId, timestamp }: PlanDeps,
): Promise<{ added: number; skipped: number; sectionsAdded: number }> {
  const existing = await loadChecklist(db, owner);
  const merge = planMerge(
    existing.sections.map((section) => {
      const tasks = existing.tasks.filter((task) => task.sectionId === section.id);
      return {
        key: section.id,
        title: section.title,
        kind: section.kind,
        taskTitles: tasks.map((task) => task.title),
        sourceTaskIds: tasks.flatMap((task) => (task.sourceTaskId ? [task.sourceTaskId] : [])),
      };
    }),
    plan,
  );

  const nextTaskPosition = new Map<string, number>();
  for (const task of existing.tasks) {
    nextTaskPosition.set(task.sectionId, Math.max(nextTaskPosition.get(task.sectionId) ?? 0, task.position + 1));
  }
  let nextSectionPosition = existing.sections.reduce((max, s) => Math.max(max, s.position + 1), 0);

  const insertTask = async (sectionId: string, task: ChecklistPlan['sections'][number]['tasks'][number]) => {
    const position = nextTaskPosition.get(sectionId) ?? 0;
    nextTaskPosition.set(sectionId, position + 1);
    await db.runAsync(
      `INSERT INTO checklist_tasks (id, section_id, title, description, notes, priority, is_done, position,
                                    source_template_id, source_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        createId(),
        sectionId,
        task.title,
        (task.description ?? '').trim(),
        (task.notes ?? '').trim(),
        parsePriority(task.priority),
        position,
        task.sourceTemplateId ?? null,
        task.sourceTaskId ?? null,
        timestamp,
        timestamp,
      ],
    );
  };

  for (const addition of merge.additions) {
    for (const task of addition.tasks) await insertTask(addition.sectionKey, task);
  }

  const column = ownerColumn(owner);
  for (const section of merge.newSections) {
    const sectionId = createId();
    await db.runAsync(
      `INSERT INTO checklist_sections (id, ${column}, title, kind, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sectionId, owner.id, cleanSectionTitle(section.title), section.kind, nextSectionPosition, timestamp, timestamp],
    );
    nextSectionPosition += 1;
    for (const task of section.tasks) await insertTask(sectionId, task);
  }

  return { added: merge.added, skipped: merge.skipped, sectionsAdded: merge.newSections.length };
}

/** Copies an owner's sections and tasks to another owner with fresh ids and nothing ticked. */
export async function copyChecklist(
  db: Database,
  from: ChecklistOwner,
  to: ChecklistOwner,
  { createId, timestamp }: PlanDeps,
  options: { keepProvenance: boolean },
): Promise<void> {
  const source = await loadChecklist(db, from);
  const column = ownerColumn(to);
  for (const section of source.sections) {
    const sectionId = createId();
    await db.runAsync(
      `INSERT INTO checklist_sections (id, ${column}, title, kind, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sectionId, to.id, section.title, section.kind, section.position, timestamp, timestamp],
    );
    for (const task of source.tasks.filter((t) => t.sectionId === section.id)) {
      await db.runAsync(
        `INSERT INTO checklist_tasks (id, section_id, title, description, notes, priority, is_done, position,
                                      source_template_id, source_task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          createId(),
          sectionId,
          task.title,
          task.description,
          task.notes,
          task.priority,
          task.position,
          options.keepProvenance ? task.sourceTemplateId : null,
          options.keepProvenance ? task.sourceTaskId : null,
          timestamp,
          timestamp,
        ],
      );
    }
  }
}

export interface ChecklistRepository {
  load(owner: ChecklistOwner): Promise<Checklist>;
  addSection(owner: ChecklistOwner, title: string, kind?: SectionKind): Promise<ChecklistSection>;
  renameSection(sectionId: string, title: string): Promise<void>;
  moveSection(sectionId: string, direction: -1 | 1): Promise<boolean>;
  deleteSection(sectionId: string): Promise<void>;
  addTask(sectionId: string, draft: TaskDraft): Promise<ChecklistTask>;
  updateTask(taskId: string, draft: TaskDraft, options?: { sectionId?: string }): Promise<void>;
  setTaskDone(taskId: string, isDone: boolean): Promise<void>;
  moveTask(taskId: string, direction: -1 | 1): Promise<boolean>;
  deleteTask(taskId: string): Promise<void>;
  applyPlan(owner: ChecklistOwner, plan: ChecklistPlan): Promise<{ added: number; skipped: number; sectionsAdded: number }>;
}

export function createChecklistRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): ChecklistRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function getSection(sectionId: string): Promise<SectionRow> {
    const row = await db.getFirstAsync<SectionRow>('SELECT * FROM checklist_sections WHERE id = ?', [sectionId]);
    if (!row) throw new ChecklistError('That section no longer exists.');
    return row;
  }

  async function getTask(taskId: string): Promise<TaskRow> {
    const row = await db.getFirstAsync<TaskRow>('SELECT * FROM checklist_tasks WHERE id = ?', [taskId]);
    if (!row) throw new ChecklistError('That task no longer exists.');
    return row;
  }

  /** Keeps a template's "last edited" time current when its contents change. */
  async function touchTemplateOf(sectionId: string, timestamp: string) {
    await db.runAsync(
      `UPDATE checklist_templates SET updated_at = ?
       WHERE id = (SELECT template_id FROM checklist_sections WHERE id = ?)`,
      [timestamp, sectionId],
    );
  }

  /** Moves one row among its siblings and rewrites dense positions. */
  async function reorder(
    table: 'checklist_sections' | 'checklist_tasks',
    siblingIds: string[],
    id: string,
    direction: -1 | 1,
    timestamp: string,
  ): Promise<boolean> {
    const index = siblingIds.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblingIds.length) return false;
    const order = [...siblingIds];
    [order[index], order[target]] = [order[target] as string, order[index] as string];
    for (let position = 0; position < order.length; position += 1) {
      await db.runAsync(`UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ?`, [
        position,
        timestamp,
        order[position] as string,
      ]);
    }
    return true;
  }

  return {
    load: (owner) => loadChecklist(db, owner),

    async addSection(owner, title, kind = 'custom') {
      const clean = cleanSectionTitle(title);
      const timestamp = stamp();
      const column = ownerColumn(owner);
      const id = deps.createId();
      const next = await db.getFirstAsync<{ next: number }>(
        `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM checklist_sections WHERE ${column} = ?`,
        [owner.id],
      );
      const position = next?.next ?? 0;
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO checklist_sections (id, ${column}, title, kind, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, owner.id, clean, kind, position, timestamp, timestamp],
        );
        await touchTemplateOf(id, timestamp);
      });
      return { id, owner, title: clean, kind, position, createdAt: timestamp, updatedAt: timestamp };
    },

    async renameSection(sectionId, title) {
      const clean = cleanSectionTitle(title);
      const timestamp = stamp();
      await getSection(sectionId);
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE checklist_sections SET title = ?, updated_at = ? WHERE id = ?', [
          clean,
          timestamp,
          sectionId,
        ]);
        await touchTemplateOf(sectionId, timestamp);
      });
    },

    async moveSection(sectionId, direction) {
      const section = await getSection(sectionId);
      const column = section.trip_id ? 'trip_id' : 'template_id';
      const siblings = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM checklist_sections WHERE ${column} = ? ${ORDER}`,
        [section.trip_id ?? section.template_id],
      );
      const timestamp = stamp();
      let moved = false;
      await db.withTransactionAsync(async () => {
        moved = await reorder('checklist_sections', siblings.map((s) => s.id), sectionId, direction, timestamp);
        if (moved) await touchTemplateOf(sectionId, timestamp);
      });
      return moved;
    },

    async deleteSection(sectionId) {
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await touchTemplateOf(sectionId, timestamp);
        // Tasks are removed by ON DELETE CASCADE.
        await db.runAsync('DELETE FROM checklist_sections WHERE id = ?', [sectionId]);
      });
    },

    async addTask(sectionId, draft) {
      const clean = cleanTaskDraft(draft);
      await getSection(sectionId);
      const timestamp = stamp();
      const id = deps.createId();
      const next = await db.getFirstAsync<{ next: number }>(
        'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM checklist_tasks WHERE section_id = ?',
        [sectionId],
      );
      const position = next?.next ?? 0;
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO checklist_tasks (id, section_id, title, description, notes, priority, is_done, position,
                                        source_template_id, source_task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)`,
          [id, sectionId, clean.title, clean.description, clean.notes, clean.priority, position, timestamp, timestamp],
        );
        await touchTemplateOf(sectionId, timestamp);
      });
      return {
        id,
        sectionId,
        ...clean,
        isDone: false,
        position,
        sourceTemplateId: null,
        sourceTaskId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    async updateTask(taskId, draft, options = {}) {
      const clean = cleanTaskDraft(draft);
      const task = await getTask(taskId);
      const timestamp = stamp();
      let sectionId = task.section_id;
      let position = task.position;

      if (options.sectionId && options.sectionId !== task.section_id) {
        const [from, to] = await Promise.all([getSection(task.section_id), getSection(options.sectionId)]);
        if (from.trip_id !== to.trip_id || from.template_id !== to.template_id) {
          throw new ChecklistError('Tasks can only move between sections of the same checklist.');
        }
        const next = await db.getFirstAsync<{ next: number }>(
          'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM checklist_tasks WHERE section_id = ?',
          [to.id],
        );
        sectionId = to.id;
        position = next?.next ?? 0;
      }

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE checklist_tasks
           SET title = ?, description = ?, notes = ?, priority = ?, section_id = ?, position = ?, updated_at = ?
           WHERE id = ?`,
          [clean.title, clean.description, clean.notes, clean.priority, sectionId, position, timestamp, taskId],
        );
        await touchTemplateOf(sectionId, timestamp);
      });
    },

    async setTaskDone(taskId, isDone) {
      // Completion only exists on trip checklists.
      const result = await db.runAsync(
        `UPDATE checklist_tasks SET is_done = ?, updated_at = ?
         WHERE id = ? AND section_id IN (SELECT id FROM checklist_sections WHERE trip_id IS NOT NULL)`,
        [isDone ? 1 : 0, stamp(), taskId],
      );
      if (result.changes === 0) throw new ChecklistError('That task no longer exists.');
    },

    async moveTask(taskId, direction) {
      const task = await getTask(taskId);
      const siblings = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM checklist_tasks WHERE section_id = ? ${ORDER}`,
        [task.section_id],
      );
      const timestamp = stamp();
      let moved = false;
      await db.withTransactionAsync(async () => {
        moved = await reorder('checklist_tasks', siblings.map((s) => s.id), taskId, direction, timestamp);
        if (moved) await touchTemplateOf(task.section_id, timestamp);
      });
      return moved;
    },

    async deleteTask(taskId) {
      const task = await db.getFirstAsync<TaskRow>('SELECT * FROM checklist_tasks WHERE id = ?', [taskId]);
      if (!task) return;
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM checklist_tasks WHERE id = ?', [taskId]);
        await touchTemplateOf(task.section_id, timestamp);
      });
    },

    async applyPlan(owner, plan) {
      let result = { added: 0, skipped: 0, sectionsAdded: 0 };
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        result = await insertPlan(db, owner, plan, { createId: deps.createId, timestamp });
      });
      return result;
    },
  };
}
