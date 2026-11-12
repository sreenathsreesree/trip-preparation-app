import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';
import { serializeTransactions } from '@/db/serialize';
import { createInventoryRepository } from '@/features/inventory/inventoryRepository';
import { emptyItemInput, type ItemInput } from '@/features/inventory/model';
import { createPackingRepository } from '@/features/packing/packingRepository';
import { createPreferencesRepository } from '@/features/packing/preferencesRepository';
import { createPurchaseRepository } from '@/features/packing/purchaseRepository';
import { createRecommendationRepository } from '@/features/packing/recommendationRepository';
import { createPhotoUploadRepository } from '@/features/journal/drive/photoUploadRepository';
import { createExpenseRepository } from '@/features/expenses/expenseRepository';
import { createJournalRepository } from '@/features/journal/journalRepository';
import { createSharingRepository } from '@/features/sharing/sharingRepository';
import { createCompanionRepository } from '@/features/planner/companionRepository';
import { createPlannerRepository } from '@/features/planner/plannerRepository';
import { createChecklistRepository } from '@/features/preparation/checklistRepository';
import { createTemplateRepository } from '@/features/preparation/templateRepository';
import type { TripInput } from '@/features/trips/model';
import { createTripRepository } from '@/features/trips/tripRepository';

import { openTestDatabase, sequentialIds, type TestDatabase } from './nodeSqliteDatabase';

export function tripInput(overrides: Partial<TripInput> = {}): TripInput {
  return {
    name: 'Goa Getaway',
    destinations: [{ name: 'North Goa' }, { name: 'South Goa' }],
    startDate: '2026-12-20',
    endDate: '2026-12-24',
    travellers: [
      { name: 'Asha', kind: 'adult' },
      { name: 'Ravi', kind: 'adult' },
      { name: 'Mia', kind: 'child' },
    ],
    transportMode: 'car',
    category: 'beach',
    ...overrides,
  };
}

export function itemInput(overrides: Partial<ItemInput> = {}): ItemInput {
  return { ...emptyItemInput(), name: 'Item', ...overrides };
}

/** Migrated database plus repositories with deterministic ids and a fixed clock. */
export async function setupRepositories(db: TestDatabase = openTestDatabase(), clock = '2026-11-10T08:00:00.000Z') {
  // Same transaction queue as the app; a nested transaction would hang and fail the test.
  const shared = serializeTransactions(db);
  await migrate(shared, migrations);
  let time = new Date(clock).getTime();
  // Each call advances the clock by a second so ordering by timestamp is stable.
  const now = () => new Date((time += 1000));
  const today = () => clock.slice(0, 10);
  const deps = { createId: sequentialIds(), now, today };
  return {
    db,
    trips: createTripRepository(shared, deps),
    checklists: createChecklistRepository(shared, deps),
    templates: createTemplateRepository(shared, deps),
    inventory: createInventoryRepository(shared, deps),
    packing: createPackingRepository(shared, deps),
    recommendations: createRecommendationRepository(shared, deps),
    purchases: createPurchaseRepository(shared, deps),
    preferences: createPreferencesRepository(shared, deps),
    planner: createPlannerRepository(shared, deps),
    companion: createCompanionRepository(shared, deps),
    journal: createJournalRepository(shared, deps),
    expenses: createExpenseRepository(shared, deps),
    sharing: createSharingRepository(shared, deps),
    photoUploads: createPhotoUploadRepository(shared, deps),
    /** Moves the shared clock forward (e.g. to test cache expiry). */
    advanceClock: (ms: number) => {
      time += ms;
    },
  };
}
