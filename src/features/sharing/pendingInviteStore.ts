import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createPendingInvite, type KeyValueStore } from './pendingInvite';

const webStore: KeyValueStore = {
  async get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage blocked: the invitation simply has to be opened again.
    }
  },
  async remove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

const nativeStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key.replace(/[^A-Za-z0-9._-]/g, '_')),
  set: (key, value) => SecureStore.setItemAsync(key.replace(/[^A-Za-z0-9._-]/g, '_'), value),
  remove: (key) => SecureStore.deleteItemAsync(key.replace(/[^A-Za-z0-9._-]/g, '_')),
};

export const pendingInvite = createPendingInvite(Platform.OS === 'web' ? webStore : nativeStore);

/** Where to go after a successful sign-in: back to a remembered invitation, else Profile. */
export async function afterSignInPath(): Promise<string> {
  const token = await pendingInvite.take();
  return token ? `/join/${encodeURIComponent(token)}` : '/profile';
}
