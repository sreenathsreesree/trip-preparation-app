import { isAuthRetryableFetchError, type Session, type User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { toErrorMessage } from '@/lib/errors';

import { AUTH_STORAGE_KEY, supabaseConfig } from './config';
import { getRedirectUrl, parseAuthCallback } from './redirect';
import { getAuthStorage, getSupabase } from './supabase';

/**
 * Google sign-in through Supabase Auth (PKCE). Authentication only: nothing in
 * this module reads or writes the local SQLite database or calls Supabase data
 * APIs — guest data stays exactly as it is (moving it to an account is G3).
 */

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export type SignInOutcome =
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type RestoreOutcome =
  | { status: 'signedIn'; user: AuthUser; offline: boolean }
  | { status: 'guest'; expired: boolean };

const NOT_CONFIGURED = 'Sign-in is not available in this build.';
const SIGN_OUT_TIMEOUT_MS = 5000;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function toAuthUser(user: Pick<User, 'id' | 'email' | 'user_metadata'>): AuthUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    email: text(user.email),
    name: text(meta.full_name) ?? text(meta.name),
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}

function friendlyAuthError(error: unknown): string {
  const message = toErrorMessage(error, 'Sign-in failed. Please try again.');
  if (/code verifier|flow state|invalid flow|auth code/i.test(message)) {
    return 'This sign-in link has expired or was already used. Please try again.';
  }
  if (isAuthRetryableFetchError(error) || /network|fetch|timed? ?out/i.test(message)) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return message;
}

/** Reads the user from the persisted session without any network access. */
export async function readStoredUser(): Promise<AuthUser | null> {
  try {
    const raw = await getAuthStorage().getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<Session> | null;
    const user = session?.user;
    return user && typeof user.id === 'string' ? toAuthUser(user) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Code exchange — exactly once per code.
//
// The redirect can reach the app twice: as the result of the auth browser and as
// a deep link opening /auth/callback (Android, or a cold start). A PKCE code is
// single-use and the verifier is consumed by the first exchange, so a second
// exchange would fail and could surface a false error. Every caller with the
// same code shares one exchange and its result.
// ---------------------------------------------------------------------------

const exchanges = new Map<string, Promise<SignInOutcome>>();

export function exchangeCodeOnce(code: string): Promise<SignInOutcome> {
  const existing = exchanges.get(code);
  if (existing) return existing;
  const attempt = (async (): Promise<SignInOutcome> => {
    const client = getSupabase();
    if (!client) return { status: 'error', message: NOT_CONFIGURED };
    try {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.session) return { status: 'error', message: friendlyAuthError(error) };
      return { status: 'signedIn', user: toAuthUser(data.session.user) };
    } catch (error) {
      return { status: 'error', message: friendlyAuthError(error) };
    }
  })();
  exchanges.set(code, attempt);
  return attempt;
}

/** Handles a redirect URL from the auth browser or an incoming deep link. */
export async function completeAuthRedirect(url: string): Promise<SignInOutcome | { status: 'ignored' }> {
  const result = parseAuthCallback(url);
  switch (result.kind) {
    case 'code':
      return exchangeCodeOnce(result.code);
    case 'cancelled':
      return { status: 'cancelled' };
    case 'error':
      return { status: 'error', message: result.message };
    default:
      return { status: 'ignored' };
  }
}

let signInInFlight: Promise<SignInOutcome> | null = null;

/** Opens Google sign-in. Concurrent calls share one attempt (no second browser). */
export function signInWithGoogle(): Promise<SignInOutcome> {
  if (!signInInFlight) {
    signInInFlight = runGoogleSignIn().finally(() => {
      signInInFlight = null;
    });
  }
  return signInInFlight;
}

const PROVIDER_CHECK_TIMEOUT_MS = 8000;

/**
 * Asks Supabase Auth's public settings endpoint whether Google sign-in is enabled,
 * so a disabled provider shows a clear message instead of an error page in the
 * browser. Returns null when the check itself could not be completed.
 */
export async function isGoogleProviderEnabled(): Promise<boolean | null> {
  if (!supabaseConfig) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseConfig.url}/auth/v1/settings`, {
      headers: { apikey: supabaseConfig.publishableKey },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const settings = (await response.json()) as { external?: Record<string, unknown> };
    return settings.external?.google === true;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runGoogleSignIn(): Promise<SignInOutcome> {
  const client = getSupabase();
  if (!client) return { status: 'error', message: NOT_CONFIGURED };

  const enabled = await isGoogleProviderEnabled();
  if (enabled === null) {
    return { status: 'error', message: 'Could not reach the sign-in service. Check your connection and try again.' };
  }
  if (!enabled) return { status: 'error', message: 'Google sign-in is not enabled for Trip Prep yet.' };

  const redirectTo = getRedirectUrl(
    Platform.OS,
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined,
  );

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { status: 'error', message: friendlyAuthError(error) };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') {
      // 'cancel' (closed by the user), 'dismiss', 'opened' or 'locked'. On Android the
      // redirect may still arrive as a deep link to /auth/callback, which completes
      // sign-in through the same exchange.
      return { status: 'cancelled' };
    }
    const outcome = await completeAuthRedirect(result.url);
    return outcome.status === 'ignored'
      ? { status: 'error', message: 'Sign-in did not return a result. Please try again.' }
      : outcome;
  } catch (error) {
    return { status: 'error', message: friendlyAuthError(error) };
  }
}

/**
 * Restores the persisted session.
 * - Valid (or refreshed) session → signed in.
 * - Refresh failed because the device is offline → stay signed in (offline-first);
 *   supabase-js refreshes again once the connection is back.
 * - Refresh rejected (revoked/expired refresh token) → guest, flagged as expired.
 */
export async function restoreSession(): Promise<RestoreOutcome> {
  const client = getSupabase();
  if (!client) return { status: 'guest', expired: false };
  const storedUser = await readStoredUser();
  try {
    const { data, error } = await client.auth.getSession();
    if (data.session) return { status: 'signedIn', user: toAuthUser(data.session.user), offline: false };
    if (error && isAuthRetryableFetchError(error) && storedUser) {
      return { status: 'signedIn', user: storedUser, offline: true };
    }
    return { status: 'guest', expired: storedUser !== null };
  } catch (error) {
    if (storedUser && isAuthRetryableFetchError(error)) return { status: 'signedIn', user: storedUser, offline: true };
    return { status: 'guest', expired: storedUser !== null };
  }
}

async function clearStoredSession(): Promise<void> {
  const storage = getAuthStorage();
  for (const key of [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`]) {
    try {
      await storage.removeItem(key);
    } catch {
      // Keep going: the remaining keys still need clearing.
    }
  }
}

/**
 * Signs this device out. Always succeeds locally, online or offline: supabase-js
 * removes the local session before asking the server to revoke the refresh token,
 * and the stored session is cleared here as well in case that request fails or
 * hangs. Never touches the SQLite database.
 *
 * Returns whether the server confirmed the revocation (false when offline).
 */
export async function signOutLocally(): Promise<{ revoked: boolean }> {
  const client = getSupabase();
  let revoked = false;
  if (client) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        client.auth.signOut({ scope: 'local' }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SIGN_OUT_TIMEOUT_MS);
        }),
      ]);
      revoked = result !== null && !result.error;
    } catch {
      revoked = false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  await clearStoredSession();
  return { revoked };
}

/** Test hook: forget shared exchanges and in-flight sign-ins. */
export function resetAuthServiceForTests() {
  exchanges.clear();
  signInInFlight = null;
}
