import { createChunkedSecureStorage, type AuthStorage } from '@/features/auth/secureStorage';

type Listener = (event: string, session: unknown) => void;

export const TEST_USER = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'traveller@example.com',
  user_metadata: { full_name: 'Asha Traveller', avatar_url: 'https://example.com/a.png' },
};

export function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    user: TEST_USER,
    ...overrides,
  };
}

/** In-memory SecureStore stand-in, wrapped by the real chunking adapter. */
export function createMemorySecureStorage(): { storage: AuthStorage; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const storage = createChunkedSecureStorage({
    getItemAsync: async (key) => entries.get(key) ?? null,
    setItemAsync: async (key, value) => {
      entries.set(key, value);
    },
    deleteItemAsync: async (key) => {
      entries.delete(key);
    },
  });
  return { storage, entries };
}

/**
 * A Supabase client stand-in exposing only `auth`. Any other property access
 * (`from`, `rpc`, `storage`, …) is recorded and throws, proving that the auth
 * flow never touches Supabase data APIs.
 */
export function createFakeSupabase() {
  const listeners = new Set<Listener>();
  const forbiddenAccess: string[] = [];
  const auth = {
    signInWithOAuth: jest.fn(async (_args: { provider: string; options: Record<string, unknown> }) => ({
      data: { provider: 'google', url: 'https://example.supabase.co/auth/v1/authorize?provider=google' },
      error: null as unknown,
    })),
    exchangeCodeForSession: jest.fn(async (_code: string) => {
      const session = makeSession();
      return { data: { session, user: session.user } as { session: unknown; user: unknown }, error: null as unknown };
    }),
    getSession: jest.fn(async () => ({ data: { session: null as unknown }, error: null as unknown })),
    signOut: jest.fn(async (_options?: { scope?: string }) => ({ error: null as unknown })),
    onAuthStateChange: jest.fn((listener: Listener) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    }),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  };
  const client = new Proxy(
    { auth },
    {
      get(target, property) {
        if (property === 'auth') return target.auth;
        if (typeof property === 'symbol' || property === 'then' || property === 'toJSON') return undefined;
        forbiddenAccess.push(property);
        throw new Error(`Auth code must not use supabase.${property}`);
      },
    },
  );
  return {
    client,
    auth,
    forbiddenAccess,
    emit: (event: string, session: unknown) => listeners.forEach((listener) => listener(event, session)),
  };
}

/** Mocks global fetch for the public `/auth/v1/settings` provider check. */
export function mockProviderSettings(google: boolean | 'offline') {
  const fetchMock = jest.fn(async () => {
    if (google === 'offline') throw new TypeError('Network request failed');
    return { ok: true, json: async () => ({ external: { google } }) };
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}
