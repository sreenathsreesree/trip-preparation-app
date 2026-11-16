/**
 * Keeps an invitation across Google sign-in. Opening an invitation while
 * signed out remembers its code; after sign-in (in-app browser on Android, a
 * redirect on the web) the app returns to the Join screen with the same code
 * instead of Profile. Joining still needs the user's tap. The code expires
 * after an hour and is cleared once used.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY = 'tripprep.pendingInvite';
export const PENDING_INVITE_TTL_MS = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function createPendingInvite(store: KeyValueStore, now: () => number = () => Date.now()) {
  return {
    async remember(token: string): Promise<void> {
      if (!TOKEN.test(token)) return;
      await store.set(KEY, JSON.stringify({ token, at: now() }));
    },
    /** The remembered code (and forgets it), or null when none or expired. */
    async take(): Promise<string | null> {
      const raw = await store.get(KEY).catch(() => null);
      await store.remove(KEY).catch(() => undefined);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as { token?: unknown; at?: unknown };
        if (typeof v.token !== 'string' || typeof v.at !== 'number' || !TOKEN.test(v.token)) return null;
        return now() - v.at <= PENDING_INVITE_TTL_MS ? v.token : null;
      } catch {
        return null;
      }
    },
    async clear(): Promise<void> {
      await store.remove(KEY).catch(() => undefined);
    },
  };
}
