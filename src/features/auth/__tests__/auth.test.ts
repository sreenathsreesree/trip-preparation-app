import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';

import {
  createFakeSupabase,
  createMemorySecureStorage,
  makeSession,
  mockProviderSettings,
  TEST_USER,
} from '../../../../test/fakeSupabase';
import {
  completeAuthRedirect,
  resetAuthServiceForTests,
  restoreSession,
  signInWithGoogle,
  signOutLocally,
} from '../authService';
import { resetAuthStoreForTests, useAuthStore } from '../authStore';

let mockSupabase = createFakeSupabase();
let mockStorage = createMemorySecureStorage();

jest.mock('../supabase', () => ({
  getSupabase: () => mockSupabase.client,
  getAuthStorage: () => mockStorage.storage,
  isCloudConfigured: () => true,
}));

jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  supabaseConfig: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(() => ({ type: 'failed' })),
}));

const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const REDIRECT = 'tripprep://auth/callback';

async function storeSession(session: unknown = makeSession()) {
  await mockStorage.storage.setItem('tripprep.auth', JSON.stringify(session));
}

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  mockStorage = createMemorySecureStorage();
  openAuthSession.mockReset();
  mockProviderSettings(true);
  resetAuthServiceForTests();
  resetAuthStoreForTests();
});

afterEach(() => {
  expect(mockSupabase.forbiddenAccess).toEqual([]);
});

describe('Google sign-in (PKCE)', () => {
  it('opens Google through Supabase and exchanges the returned code', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?code=the-code` });

    const outcome = await signInWithGoogle();

    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
    expect(openAuthSession).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/authorize?provider=google',
      REDIRECT,
    );
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('the-code');
    expect(outcome).toEqual({
      status: 'signedIn',
      user: {
        id: TEST_USER.id,
        email: 'traveller@example.com',
        name: 'Asha Traveller',
        avatarUrl: 'https://example.com/a.png',
      },
    });
  });

  it.each(['cancel', 'dismiss'])('treats a %s result as a cancellation', async (type) => {
    openAuthSession.mockResolvedValue({ type });
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
    expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('treats a declined consent screen as a cancellation', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?error=access_denied` });
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports a provider error from the redirect', async () => {
    openAuthSession.mockResolvedValue({
      type: 'success',
      url: `${REDIRECT}?error=server_error&error_description=Something%20broke`,
    });
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'error', message: 'Something broke' });
  });

  it('reports a failed exchange with a clear message', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?code=stale` });
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthApiError('invalid flow state, no valid flow state found', 404, 'flow_state_not_found'),
    });
    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'This sign-in link has expired or was already used. Please try again.',
    });
  });

  it('does not open the browser when Google is not enabled for the project', async () => {
    mockProviderSettings(false);
    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'Google sign-in is not enabled for Trip Prep yet.',
    });
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it('does not open the browser while offline', async () => {
    mockProviderSettings('offline');
    const outcome = await signInWithGoogle();
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('connection') });
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it('shares one attempt when sign-in is tapped twice', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?code=one` });
    const [a, b] = await Promise.all([signInWithGoogle(), signInWithGoogle()]);
    expect(a).toEqual(b);
    expect(openAuthSession).toHaveBeenCalledTimes(1);
  });
});

describe('duplicate code exchange protection', () => {
  it('exchanges a code once when the browser result and a deep link both deliver it', async () => {
    let releaseBrowser: (value: unknown) => void = () => undefined;
    openAuthSession.mockReturnValue(new Promise((resolve) => (releaseBrowser = resolve)));

    const signIn = signInWithGoogle();
    // The deep link (/auth/callback) arrives first…
    const fromDeepLink = completeAuthRedirect(`auth/callback?code=shared-code`);
    // …then the auth browser resolves with the same redirect.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseBrowser({ type: 'success', url: `${REDIRECT}?code=shared-code` });

    const [browserOutcome, deepLinkOutcome] = await Promise.all([signIn, fromDeepLink]);
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(browserOutcome).toMatchObject({ status: 'signedIn' });
    expect(deepLinkOutcome).toEqual(browserOutcome);
  });

  it('does not re-exchange a code that was already used', async () => {
    await completeAuthRedirect(`${REDIRECT}?code=used`);
    await completeAuthRedirect(`${REDIRECT}?code=used`);
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('ignores callback URLs without a code', async () => {
    await expect(completeAuthRedirect(REDIRECT)).resolves.toEqual({ status: 'ignored' });
    expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('session restoration', () => {
  it('restores a valid stored session', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() }, error: null });
    await expect(restoreSession()).resolves.toMatchObject({ status: 'signedIn', offline: false });
  });

  it('stays signed in from the stored session while offline', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Network request failed', 0),
    });
    await expect(restoreSession()).resolves.toMatchObject({
      status: 'signedIn',
      offline: true,
      user: { id: TEST_USER.id },
    });
  });

  it('falls back to guest and flags an expired session when the refresh is rejected', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    });
    await expect(restoreSession()).resolves.toEqual({ status: 'guest', expired: true });
  });

  it('is a guest with no stored session', async () => {
    await expect(restoreSession()).resolves.toEqual({ status: 'guest', expired: false });
  });
});

describe('sign-out', () => {
  it('signs out of this device and clears the stored session', async () => {
    await storeSession();
    await mockStorage.storage.setItem('tripprep.auth-code-verifier', 'verifier');
    await expect(signOutLocally()).resolves.toEqual({ revoked: true });
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mockStorage.entries.size).toBe(0);
  });

  it('still signs out locally when the network request fails', async () => {
    await storeSession();
    mockSupabase.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(signOutLocally()).resolves.toEqual({ revoked: false });
    expect(mockStorage.entries.size).toBe(0);
  });

  it('does not wait forever for an unreachable server', async () => {
    jest.useFakeTimers();
    try {
      await storeSession();
      mockSupabase.auth.signOut.mockReturnValueOnce(new Promise(() => undefined));
      const pending = signOutLocally();
      await jest.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual({ revoked: false });
      expect(mockStorage.entries.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('auth store', () => {
  it('restores a signed-in user at startup', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() }, error: null });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      offline: false,
      user: { email: 'traveller@example.com', name: 'Asha Traveller' },
    });
  });

  it('starts as a guest without a stored session', async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null, notice: null });
  });

  it('shows an expired notice when a stored session can no longer be refreshed', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', notice: 'expired' });
  });

  it('moves to guest with an expired notice when supabase-js signs the user out', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() }, error: null });
    await useAuthStore.getState().initialize();
    mockSupabase.emit('SIGNED_OUT', null);
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null, notice: 'expired' });
  });

  it('follows token refreshes', async () => {
    await useAuthStore.getState().initialize();
    mockSupabase.emit('TOKEN_REFRESHED', makeSession());
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', user: { id: TEST_USER.id } });
  });

  it('records a cancelled sign-in and stays a guest', async () => {
    await useAuthStore.getState().initialize();
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    await useAuthStore.getState().signIn();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', notice: 'cancelled', error: null, pending: null });
  });

  it('signs in and then out, reporting the result', async () => {
    await useAuthStore.getState().initialize();
    openAuthSession.mockResolvedValue({ type: 'success', url: `${REDIRECT}?code=ok` });
    await useAuthStore.getState().signIn();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', pending: null });

    mockSupabase.auth.signOut.mockImplementationOnce(async () => {
      mockSupabase.emit('SIGNED_OUT', null); // supabase-js fires this during sign-out
      return { error: null };
    });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null, notice: 'signedOut' });
  });

  it('reports an offline sign-out without failing it', async () => {
    await storeSession();
    mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: makeSession() }, error: null });
    await useAuthStore.getState().initialize();
    mockSupabase.auth.signOut.mockResolvedValueOnce({ error: new AuthRetryableFetchError('offline', 0) });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', notice: 'signedOutOffline' });
  });

  it('completes sign-in from a deep link', async () => {
    await useAuthStore.getState().initialize();
    await useAuthStore.getState().handleRedirect('auth/callback?code=deep');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', pending: null });
  });
});
