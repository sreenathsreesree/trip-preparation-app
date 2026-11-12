import { requestGoogleScopes, type AuthUser } from '@/features/auth/authService';
import { DRIVE_STORAGE_KEY } from '@/features/auth/config';
import { getAuthStorage, isCloudConfigured } from '@/features/auth/supabase';

import { DriveError } from './driveClient';

/**
 * Google Drive connection for the journal backup.
 *
 * The Google access token comes from a Google sign-in that asked for the
 * `drive.file` scope. It is kept in secure storage with its expiry, belongs to
 * the signed-in account, is never logged or synced, and is removed on
 * disconnect or sign-out. Google access tokens last about an hour; refreshing
 * one without asking again needs the OAuth client secret on a server, which is
 * not set up, so an expired token asks the user to reconnect.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const STORAGE_KEY = DRIVE_STORAGE_KEY;
/** Assume a little under Google's usual one hour. */
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

/** Drive needs the build flag (set once the Drive API and scope are configured) and Supabase sign-in. */
export function isDriveConfigured(flag: string | undefined = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED): boolean {
  return flag?.trim().toLowerCase() === 'true' && isCloudConfigured();
}

export interface DriveConnection {
  userId: string;
  email: string | null;
  connectedAt: string;
  expiresAt: string;
}

interface StoredToken extends DriveConnection {
  token: string;
}

async function readStored(): Promise<StoredToken | null> {
  try {
    const raw = await getAuthStorage().getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof value.token !== 'string' || typeof value.userId !== 'string' || typeof value.expiresAt !== 'string') return null;
    return value as StoredToken;
  } catch {
    return null;
  }
}

/** The saved connection (without the token), if it belongs to `userId`. */
export async function driveConnection(userId: string | null): Promise<DriveConnection | null> {
  const stored = await readStored();
  if (!stored || !userId || stored.userId !== userId) return null;
  const { token: _token, ...connection } = stored;
  return connection;
}

export const isExpired = (connection: Pick<DriveConnection, 'expiresAt'>, now = new Date()) => Date.parse(connection.expiresAt) <= now.getTime();

/** A valid token for `userId`, or a DriveError('auth') asking to reconnect. */
export async function driveToken(userId: string | null, now = new Date()): Promise<string> {
  const stored = await readStored();
  if (!stored || !userId || stored.userId !== userId || isExpired(stored, now)) throw new DriveError('auth');
  return stored.token;
}

export async function disconnectDrive(): Promise<void> {
  await getAuthStorage().removeItem(STORAGE_KEY);
}

export type ConnectOutcome = { status: 'connected'; connection: DriveConnection } | { status: 'cancelled' } | { status: 'error'; message: string };

/**
 * Asks Google for Drive access for the signed-in account. If a different
 * Google account is chosen, nothing is kept and the user is told why.
 */
export async function connectDrive(current: AuthUser): Promise<ConnectOutcome> {
  let captured: { token: string; user: AuthUser } | null = null;
  const outcome = await requestGoogleScopes({
    scopes: DRIVE_SCOPE,
    loginHint: current.email,
    onProviderToken: (token, user) => {
      captured = { token, user };
    },
  });
  if (outcome.status === 'cancelled') return { status: 'cancelled' };
  if (outcome.status === 'error') return { status: 'error', message: outcome.message };
  const got = captured as { token: string; user: AuthUser } | null;
  if (!got) return { status: 'error', message: 'Google didn’t grant Drive access. Try again and allow access to Google Drive.' };
  if (got.user.id !== current.id) {
    return { status: 'error', message: 'You chose a different Google account. Connect Drive with the account you’re signed in with.' };
  }
  const now = new Date();
  const stored: StoredToken = {
    token: got.token,
    userId: current.id,
    email: current.email,
    connectedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
  };
  await getAuthStorage().setItem(STORAGE_KEY, JSON.stringify(stored));
  const { token: _token, ...connection } = stored;
  return { status: 'connected', connection };
}
