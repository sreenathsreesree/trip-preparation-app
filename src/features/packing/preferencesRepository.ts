import type { Database } from '@/db/types';

import { DEFAULT_PREFERENCES, isPackingStyle, type UserPreferences } from './model';

/** Reads user preferences (missing keys fall back to defaults). */
export async function getPreferences(db: Database): Promise<UserPreferences> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM user_preferences', []);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const style = map.get('packingStyle');
  return { packingStyle: isPackingStyle(style) ? style : DEFAULT_PREFERENCES.packingStyle };
}

export interface PreferencesRepository {
  get(): Promise<UserPreferences>;
  set(patch: Partial<UserPreferences>): Promise<UserPreferences>;
}

export function createPreferencesRepository(db: Database, deps: { now?: () => Date } = {}): PreferencesRepository {
  const now = deps.now ?? (() => new Date());
  return {
    get: () => getPreferences(db),
    async set(patch) {
      if (patch.packingStyle !== undefined) {
        if (!isPackingStyle(patch.packingStyle)) throw new Error('Unknown packing style.');
        await db.runAsync(
          `INSERT INTO user_preferences (key, value, updated_at) VALUES ('packingStyle', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [patch.packingStyle, now().toISOString()],
        );
      }
      return getPreferences(db);
    },
  };
}
