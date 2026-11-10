import { createChecklistRepository } from '@/features/preparation/checklistRepository';
import { createTemplateRepository } from '@/features/preparation/templateRepository';
import { createTripRepository } from '@/features/trips/tripRepository';
import { createId } from '@/lib/id';

import { getDatabase } from './client';
import { getSchemaVersion } from './migrate';

/**
 * Resolves repositories bound to the shared app database. Stores depend on
 * this module; screens never touch SQL directly.
 */
export async function getRepositories() {
  const db = await getDatabase();
  return {
    trips: createTripRepository(db, { createId }),
    checklists: createChecklistRepository(db, { createId }),
    templates: createTemplateRepository(db, { createId }),
    schemaVersion: () => getSchemaVersion(db),
    countTasks: async () => {
      const row = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM checklist_tasks k
         JOIN checklist_sections s ON s.id = k.section_id WHERE s.trip_id IS NOT NULL`,
        [],
      );
      return row?.count ?? 0;
    },
  };
}

export type Repositories = Awaited<ReturnType<typeof getRepositories>>;
