import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { AUTH_STORAGE_KEY, supabaseConfig } from './config';
import { createChunkedSecureStorage, createWebStorage, type AuthStorage } from './secureStorage';

/**
 * The app's Supabase client — used for authentication only in G2 (no data API
 * calls until sync lands in G4). Null when the app is not configured, in which
 * case the app is guest-only.
 */

let storage: AuthStorage | null = null;
let client: SupabaseClient | null = null;

export function getAuthStorage(): AuthStorage {
  if (!storage) {
    storage =
      Platform.OS === 'web'
        ? createWebStorage()
        : createChunkedSecureStorage({
            getItemAsync: (key) => SecureStore.getItemAsync(key),
            setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
            deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
          });
  }
  return storage;
}

export function isCloudConfigured(): boolean {
  return supabaseConfig !== null;
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfig) return null;
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        flowType: 'pkce',
        storage: getAuthStorage(),
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // The app handles the OAuth redirect itself (browser result or the
        // /auth/callback route), so the client never reads tokens from a URL.
        detectSessionInUrl: false,
      },
    });

    if (Platform.OS !== 'web') {
      // Refresh tokens only while the app is in the foreground (the supabase-js
      // guidance for React Native); the browser build manages this itself.
      const auth = client.auth;
      if (AppState.currentState === 'active') auth.startAutoRefresh();
      AppState.addEventListener('change', (state) => {
        if (state === 'active') auth.startAutoRefresh();
        else auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
