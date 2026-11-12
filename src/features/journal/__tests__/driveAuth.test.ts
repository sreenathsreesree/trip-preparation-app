import * as WebBrowser from 'expo-web-browser';

import { createFakeSupabase, createMemorySecureStorage, makeSession, mockProviderSettings, TEST_USER } from '../../../../test/fakeSupabase';
import { resetAuthServiceForTests, signInWithGoogle, signOutLocally, toAuthUser } from '../../auth/authService';
import { connectDrive, disconnectDrive, driveConnection, driveToken, DRIVE_SCOPE, isDriveConfigured } from '../drive/driveAuth';

let mockSupabase = createFakeSupabase();
let mockStorage = createMemorySecureStorage();

jest.mock('../../auth/supabase', () => ({
  getSupabase: () => mockSupabase.client,
  getAuthStorage: () => mockStorage.storage,
  isCloudConfigured: () => true,
}));

jest.mock('../../auth/config', () => ({
  ...jest.requireActual('../../auth/config'),
  supabaseConfig: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(() => ({ type: 'failed' })),
}));

const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const me = toAuthUser(TEST_USER);

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  mockStorage = createMemorySecureStorage();
  openAuthSession.mockReset();
  openAuthSession.mockResolvedValue({ type: 'success', url: 'tripprep://auth/callback?code=c1' });
  mockProviderSettings(true);
  resetAuthServiceForTests();
});

const withProviderToken = (user = TEST_USER) =>
  mockSupabase.auth.exchangeCodeForSession.mockImplementation(async () => {
    const session = makeSession({ provider_token: 'google-access-token', user });
    return { data: { session, user: session.user }, error: null };
  });

describe('Google Drive connection', () => {
  it('is off unless the build flag is set', () => {
    expect(isDriveConfigured(undefined)).toBe(false);
    expect(isDriveConfigured('false')).toBe(false);
    expect(isDriveConfigured('true')).toBe(true);
  });

  it('asks only for the drive.file scope for the signed-in account and keeps the token securely', async () => {
    withProviderToken();
    const outcome = await connectDrive(me);
    expect(outcome.status).toBe('connected');
    const call = mockSupabase.auth.signInWithOAuth.mock.calls[0]?.[0];
    expect(call?.options).toMatchObject({
      scopes: DRIVE_SCOPE,
      queryParams: { include_granted_scopes: 'true', login_hint: TEST_USER.email, prompt: 'consent' },
    });
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(await driveToken(me.id)).toBe('google-access-token');
    const connection = await driveConnection(me.id);
    expect(connection).toMatchObject({ userId: me.id, email: TEST_USER.email });
    expect(JSON.stringify(connection)).not.toContain('google-access-token');
    expect(await driveConnection('someone-else')).toBeNull();
    await expect(driveToken('someone-else')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('expires after about an hour and asks to reconnect', async () => {
    withProviderToken();
    await connectDrive(me);
    const later = new Date(Date.now() + 56 * 60 * 1000);
    await expect(driveToken(me.id, later)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('keeps nothing when another Google account is chosen', async () => {
    withProviderToken({ ...TEST_USER, id: '99999999-2222-4333-8444-555555555555' });
    const outcome = await connectDrive(me);
    expect(outcome).toEqual({ status: 'error', message: expect.stringMatching(/different Google account/) });
    await expect(driveToken(me.id)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('never keeps the Google token from a normal sign-in', async () => {
    withProviderToken();
    await signInWithGoogle();
    await expect(driveToken(me.id)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('is cleared by disconnect and by sign-out', async () => {
    withProviderToken();
    await connectDrive(me);
    await disconnectDrive();
    expect(await driveConnection(me.id)).toBeNull();
    await connectDrive(me);
    await signOutLocally();
    expect(await driveConnection(me.id)).toBeNull();
  });
});
