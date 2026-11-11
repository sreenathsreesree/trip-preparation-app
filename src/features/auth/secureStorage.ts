/**
 * Session storage for supabase-js.
 *
 * Native: expo-secure-store (Android Keystore / iOS Keychain). Sessions can be
 * larger than is comfortable for one secure entry, so values are split into
 * chunks: `<key>.n` holds the chunk count and `<key>.0…` the parts. A missing or
 * damaged chunk reads as "no session" (the user signs in again) rather than a
 * corrupted one.
 *
 * Web (development only): localStorage. Nothing here touches the SQLite database.
 */

export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Characters per chunk; well under the size where secure stores start to warn or fail. */
export const CHUNK_SIZE = 1800;

const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

/** SecureStore keys may contain only [A-Za-z0-9._-]; map anything else to `_`. */
export function toSecureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function readCount(backend: SecureBackend, key: string): Promise<number> {
  const raw = await backend.getItemAsync(countKey(key));
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 && count < 1000 ? count : 0;
}

async function removeChunks(backend: SecureBackend, key: string, from: number, to: number) {
  for (let index = from; index < to; index += 1) await backend.deleteItemAsync(chunkKey(key, index));
}

export function createChunkedSecureStorage(backend: SecureBackend): AuthStorage {
  return {
    async getItem(rawKey) {
      const key = toSecureKey(rawKey);
      const count = await readCount(backend, key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const part = await backend.getItemAsync(chunkKey(key, index));
        if (part === null) {
          // Incomplete write (e.g. the app was killed): treat as signed out.
          await backend.deleteItemAsync(countKey(key));
          await removeChunks(backend, key, 0, count);
          return null;
        }
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(rawKey, value) {
      const key = toSecureKey(rawKey);
      const previous = await readCount(backend, key);
      const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      // Invalidate first so a crash mid-write can never yield a mix of old and new chunks.
      await backend.deleteItemAsync(countKey(key));
      for (let index = 0; index < count; index += 1) {
        await backend.setItemAsync(chunkKey(key, index), value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
      }
      await backend.setItemAsync(countKey(key), String(count));
      if (previous > count) await removeChunks(backend, key, count, previous);
    },

    async removeItem(rawKey) {
      const key = toSecureKey(rawKey);
      const count = await readCount(backend, key);
      await backend.deleteItemAsync(countKey(key));
      await removeChunks(backend, key, 0, Math.max(count, 1));
    },
  };
}

/** Browser storage for web development; an in-memory map when localStorage is unavailable. */
export function createWebStorage(): AuthStorage {
  const memory = new Map<string, string>();
  const local = (): Storage | null => {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    async getItem(key) {
      try {
        const store = local();
        return store ? store.getItem(key) : memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    async setItem(key, value) {
      try {
        const store = local();
        if (store) store.setItem(key, value);
        else memory.set(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    async removeItem(key) {
      memory.delete(key);
      try {
        local()?.removeItem(key);
      } catch {
        // Nothing else to clear.
      }
    },
  };
}
