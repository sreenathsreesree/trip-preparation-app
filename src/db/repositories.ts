import { createPhotoUploadRepository } from '@/features/journal/drive/photoUploadRepository';
import { createJournalRepository } from '@/features/journal/journalRepository';
import { createSharingRepository } from '@/features/sharing/sharingRepository';
import { createInventoryRepository } from '@/features/inventory/inventoryRepository';
import { createPackingRepository } from '@/features/packing/packingRepository';
import { createPreferencesRepository } from '@/features/packing/preferencesRepository';
import { createPurchaseRepository } from '@/features/packing/purchaseRepository';
import { createRecommendationRepository } from '@/features/packing/recommendationRepository';
import { createPlannerRepository } from '@/features/planner/plannerRepository';
import { createCompanionRepository } from '@/features/planner/companionRepository';
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
    inventory: createInventoryRepository(db, { createId }),
    packing: createPackingRepository(db, { createId }),
    recommendations: createRecommendationRepository(db, { createId }),
    purchases: createPurchaseRepository(db, { createId }),
    preferences: createPreferencesRepository(db),
    planner: createPlannerRepository(db, { createId }),
    companion: createCompanionRepository(db, { createId }),
    journal: createJournalRepository(db, { createId }),
    sharing: createSharingRepository(db, {}),
    photoUploads: createPhotoUploadRepository(db, { createId }),
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
