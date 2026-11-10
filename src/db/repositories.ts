import { createPrepItemRepository } from '@/features/preparation/prepItemRepository';
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
    prepItems: createPrepItemRepository(db, { createId }),
    schemaVersion: () => getSchemaVersion(db),
  };
}

export type Repositories = Awaited<ReturnType<typeof getRepositories>>;
