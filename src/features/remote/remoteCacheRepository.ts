import type { Database } from '@/db/types';

export interface CachedResponse<T> {
  payload: T;
  source: string;
  fetchedAt: string;
}

/** Responses from public providers kept in the account's own database (offline use, fewer requests). */
export function createRemoteCacheRepository(db: Database) {
  return {
    async get<T>(key: string): Promise<CachedResponse<T> | null> {
      const row = await db.getFirstAsync<{ payload: string; source: string; fetched_at: string }>('SELECT payload, source, fetched_at FROM remote_cache WHERE key = ?', [key]);
      if (!row) return null;
      try {
        return { payload: JSON.parse(row.payload) as T, source: row.source, fetchedAt: row.fetched_at };
      } catch {
        return null;
      }
    },
    async set(key: string, kind: string, source: string, payload: unknown, fetchedAt: string): Promise<void> {
      await db.runAsync(
        `INSERT INTO remote_cache (key, kind, source, payload, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, source = excluded.source, payload = excluded.payload, fetched_at = excluded.fetched_at`,
        [key, kind, source, JSON.stringify(payload), fetchedAt],
      );
    },
    /** Drops entries older than `before` (keeps the cache small). */
    async prune(kind: string, before: string): Promise<number> {
      return (await db.runAsync('DELETE FROM remote_cache WHERE kind = ? AND fetched_at < ?', [kind, before])).changes;
    },
  };
}

export type RemoteCacheRepository = ReturnType<typeof createRemoteCacheRepository>;

/** Cache-first fetch: fresh enough cache wins; otherwise fetch and store; offline falls back to any cache (marked stale). */
export async function cachedFetch<T>(
  cache: RemoteCacheRepository,
  input: { key: string; kind: string; source: string; maxAgeMs: number; now: Date },
  fetcher: () => Promise<T>,
): Promise<{ payload: T; fetchedAt: string; from: 'cache' | 'live' | 'stale_cache' }> {
  const hit = await cache.get<T>(input.key);
  if (hit && input.now.getTime() - Date.parse(hit.fetchedAt) < input.maxAgeMs) return { payload: hit.payload, fetchedAt: hit.fetchedAt, from: 'cache' };
  try {
    const payload = await fetcher();
    const fetchedAt = input.now.toISOString();
    await cache.set(input.key, input.kind, input.source, payload, fetchedAt);
    return { payload, fetchedAt, from: 'live' };
  } catch (error) {
    if (hit) return { payload: hit.payload, fetchedAt: hit.fetchedAt, from: 'stale_cache' };
    throw error;
  }
}
