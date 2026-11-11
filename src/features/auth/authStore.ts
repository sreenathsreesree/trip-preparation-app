import { create } from 'zustand';

import {
  completeAuthRedirect,
  readStoredUser,
  restoreSession,
  signInWithGoogle,
  signOutLocally,
  toAuthUser,
  type AuthUser,
  type SignInOutcome,
} from './authService';
import { getSupabase, isCloudConfigured } from './supabase';

/**
 * Who is using the app on this device. Guest and signed-in users see the same
 * local data in G2; nothing here reads or changes it. (G3 adds per-account data.)
 */
export type AuthStatus = 'initializing' | 'guest' | 'signedIn';

/** One-off messages shown on the account surfaces. */
export type AuthNotice = 'cancelled' | 'expired' | 'signedOut' | 'signedOutOffline';

interface AuthState {
  /** False when the build has no Supabase configuration: the app is guest-only. */
  configured: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  /** Signed in from the stored session while the server could not be reached. */
  offline: boolean;
  pending: 'signIn' | 'signOut' | 'callback' | null;
  error: string | null;
  notice: AuthNotice | null;
  /** Restores the session once at startup (safe to call repeatedly). */
  initialize: () => Promise<void>;
  signIn: () => Promise<SignInOutcome>;
  /** Completes sign-in from a deep link to /auth/callback. */
  handleRedirect: (url: string) => Promise<SignInOutcome | { status: 'ignored' }>;
  signOut: () => Promise<void>;
  clearMessages: () => void;
}

let initializing: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>()((set, get) => {
  const applyOutcome = (outcome: SignInOutcome | { status: 'ignored' }) => {
    if (outcome.status === 'signedIn') {
      set({ status: 'signedIn', user: outcome.user, offline: false, error: null, notice: null });
    } else if (outcome.status === 'cancelled') {
      set({ error: null, notice: 'cancelled' });
    } else if (outcome.status === 'error') {
      set({ error: outcome.message, notice: null });
    }
  };

  return {
    configured: isCloudConfigured(),
    status: isCloudConfigured() ? 'initializing' : 'guest',
    user: null,
    offline: false,
    pending: null,
    error: null,
    notice: null,

    initialize: () => {
      if (!initializing) {
        initializing = (async () => {
          const client = getSupabase();
          if (!client) {
            set({ status: 'guest', user: null });
            return;
          }

          // React to changes made by supabase-js itself (token refresh, a refresh
          // token rejected by the server, sign-in completing elsewhere).
          if (!unsubscribe) {
            const { data } = client.auth.onAuthStateChange((event, session) => {
              if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
                set({ status: 'signedIn', offline: false, user: toAuthUser(session.user) });
              } else if (event === 'SIGNED_OUT') {
                const wasSignedIn = get().status === 'signedIn';
                const userInitiated = get().pending === 'signOut';
                set({
                  status: 'guest',
                  user: null,
                  offline: false,
                  notice: wasSignedIn && !userInitiated ? 'expired' : get().notice,
                });
              }
            });
            unsubscribe = () => data.subscription.unsubscribe();
          }

          // Offline-first: show the stored account immediately, then confirm it.
          const stored = await readStoredUser();
          if (stored && get().status === 'initializing') set({ status: 'signedIn', user: stored });

          const restored = await restoreSession();
          if (restored.status === 'signedIn') {
            set({ status: 'signedIn', user: restored.user, offline: restored.offline });
          } else if (get().pending !== 'signIn' && get().pending !== 'callback') {
            set({
              status: 'guest',
              user: null,
              offline: false,
              notice: restored.expired ? 'expired' : get().notice,
            });
          }
        })().catch(() => {
          set({ status: 'guest', user: null, offline: false });
        });
      }
      return initializing;
    },

    signIn: async () => {
      if (!get().configured) {
        const outcome: SignInOutcome = { status: 'error', message: 'Sign-in is not available in this build.' };
        applyOutcome(outcome);
        return outcome;
      }
      set({ pending: 'signIn', error: null, notice: null });
      try {
        const outcome = await signInWithGoogle();
        // A deep link may already have completed sign-in while the browser reported "cancel".
        if (outcome.status === 'cancelled' && get().status === 'signedIn') return { status: 'signedIn', user: get().user! };
        applyOutcome(outcome);
        return outcome;
      } finally {
        set({ pending: null });
      }
    },

    handleRedirect: async (url) => {
      set({ pending: get().pending ?? 'callback' });
      try {
        const outcome = await completeAuthRedirect(url);
        if (!(outcome.status === 'cancelled' && get().status === 'signedIn')) applyOutcome(outcome);
        return outcome;
      } finally {
        if (get().pending === 'callback') set({ pending: null });
      }
    },

    signOut: async () => {
      set({ pending: 'signOut', error: null, notice: null });
      try {
        const { revoked } = await signOutLocally();
        set({ status: 'guest', user: null, offline: false, notice: revoked ? 'signedOut' : 'signedOutOffline' });
      } finally {
        set({ pending: null });
      }
    },

    clearMessages: () => set({ error: null, notice: null }),
  };
});

/** Test hook: drop the subscription and the one-time initialisation. */
export function resetAuthStoreForTests() {
  unsubscribe?.();
  unsubscribe = null;
  initializing = null;
  useAuthStore.setState({
    configured: isCloudConfigured(),
    status: isCloudConfigured() ? 'initializing' : 'guest',
    user: null,
    offline: false,
    pending: null,
    error: null,
    notice: null,
  });
}
