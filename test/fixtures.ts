import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';
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

/** Migrated database plus repositories with deterministic ids and a fixed clock. */
export async function setupRepositories(db: TestDatabase = openTestDatabase(), clock = '2026-11-10T08:00:00.000Z') {
  await migrate(db, migrations);
  let time = new Date(clock).getTime();
  // Each call advances the clock by a second so ordering by timestamp is stable.
  const now = () => new Date((time += 1000));
  const deps = { createId: sequentialIds(), now };
  return {
    db,
    trips: createTripRepository(db, deps),
    checklists: createChecklistRepository(db, deps),
    templates: createTemplateRepository(db, deps),
  };
}
