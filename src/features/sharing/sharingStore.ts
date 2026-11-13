import { accountScoped } from '@/lib/accountScopedStores';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { getSupabase, isCloudConfigured } from '@/features/auth/supabase';
import { bytesToBase64 } from '@/lib/imageStore';
import { toErrorMessage } from '@/lib/errors';

import { syncSharedTrip } from './sharedSync';
import { createSupabaseSharingApi, type SharedInvite, type SharedMember, type SharingApi } from './sharingApi';
import type { SharedEntry, SharedSpace } from './sharingRepository';
import { createInvite, joinTrip, shareTrip, stopSharing, type Account } from './sharingService';

export interface TripSharing {
  space: SharedSpace | null;
  members: SharedMember[];
  others: SharedEntry[];
  waiting: number;
  invites: SharedInvite[] | null;
  syncing: boolean;
  error: string | null;
}

const EMPTY: TripSharing = { space: null, members: [], others: [], waiting: 0, invites: null, syncing: false, error: null };

interface SharingState {
  byTrip: Record<string, TripSharing>;
  load: (tripId: string) => Promise<void>;
  sync: (tripId: string) => Promise<void>;
  syncAll: () => Promise<void>;
  share: (trip: { id: string; name: string; startDate: string; endDate: string }) => Promise<void>;
  createInviteLink: (tripId: string, role: 'editor' | 'viewer') => Promise<string>;
  loadInvites: (tripId: string) => Promise<void>;
  revokeInvite: (tripId: string, inviteId: string) => Promise<void>;
  setRole: (tripId: string, userId: string, role: 'editor' | 'viewer') => Promise<void>;
  removeMember: (tripId: string, userId: string) => Promise<void>;
  transfer: (tripId: string, userId: string) => Promise<void>;
  stop: (tripId: string) => Promise<void>;
  join: (token: string) => Promise<string>;
  /** Called after a journal entry changes; queues it if the trip is shared. */
  entryChanged: (tripId: string, entryId: string) => Promise<void>;
}

/** The sharing API, or null when this build has no Trip Prep cloud. */
export function sharingApi(): SharingApi | null {
  const client = isCloudConfigured() ? getSupabase() : null;
  return client ? createSupabaseSharingApi(client) : null;
}

export function currentAccount(): Account | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  return { id: user.id, displayName: user.name ?? user.email?.split('@')[0] ?? 'Traveller' };
}

function requireOnline(): { api: SharingApi; account: Account } {
  const api = sharingApi();
  if (!api) throw new Error('Trip sharing isn’t available in this build.');
  const account = currentAccount();
  if (!account) throw new Error('Sign in with Google to share trips.');
  return { api, account };
}

const tokens = {
  randomToken: () => bytesToBase64(Crypto.getRandomBytes(24)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  sha256Hex: (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
};

export const useSharingStore = accountScoped(create<SharingState>()((set, get) => {
  const put = (tripId: string, patch: Partial<TripSharing>) =>
    set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), ...patch } } }));

  async function refreshLocal(tripId: string) {
    const { sharing } = await getRepositories();
    const space = await sharing.space(tripId);
    const account = currentAccount();
    const mine = space && account && space.accountId === account.id ? space : null;
    put(tripId, {
      space: mine,
      members: mine ? await sharing.members(mine.cloudTripId) : [],
      others: mine ? await sharing.sharedEntries(mine.cloudTripId) : [],
      waiting: mine ? (await sharing.outboxCount(tripId)) + (await (await getRepositories()).expenses.outboxCount(tripId)) : 0,
    });
  }

  async function run<T>(tripId: string, fn: () => Promise<T>): Promise<T> {
    put(tripId, { error: null });
    try {
      return await fn();
    } catch (error) {
      put(tripId, { error: toErrorMessage(error, 'Sharing failed.') });
      throw error;
    } finally {
      await refreshLocal(tripId).catch(() => undefined);
    }
  }

  return {
    byTrip: {},

    load: (tripId) => refreshLocal(tripId).catch(() => undefined),

    async sync(tripId) {
      const api = sharingApi();
      const account = currentAccount();
      if (!api || !account || get().byTrip[tripId]?.syncing) return;
      put(tripId, { syncing: true });
      try {
        const { sharing, expenses } = await getRepositories();
        const result = await syncSharedTrip(tripId, { api, repo: sharing, accountId: account.id, expenses });
        put(tripId, { error: result.error });
      } finally {
        put(tripId, { syncing: false });
        await refreshLocal(tripId).catch(() => undefined);
      }
    },

    async syncAll() {
      const account = currentAccount();
      if (!account || !sharingApi()) return;
      const { sharing } = await getRepositories();
      for (const space of await sharing.spaces(account.id)) {
        if (space.role !== 'removed') await get().sync(space.tripId);
      }
    },

    share: (trip) =>
      run(trip.id, async () => {
        const { api, account } = requireOnline();
        await shareTrip(trip, account, { api, repos: await getRepositories() });
        void get().sync(trip.id);
      }),

    createInviteLink: (tripId, role) =>
      run(tripId, async () => {
        const { api } = requireOnline();
        const space = get().byTrip[tripId]?.space;
        if (!space) throw new Error('Share the trip first.');
        const { token } = await createInvite(space.cloudTripId, role, { api, tokens });
        void get().loadInvites(tripId);
        return Linking.createURL(`/join/${token}`);
      }),

    loadInvites: (tripId) =>
      run(tripId, async () => {
        const { api } = requireOnline();
        const space = get().byTrip[tripId]?.space;
        if (space?.role === 'owner') put(tripId, { invites: await api.invites(space.cloudTripId) });
      }),

    revokeInvite: (tripId, inviteId) =>
      run(tripId, async () => {
        await requireOnline().api.revokeInvite(inviteId);
        await get().loadInvites(tripId);
      }),

    setRole: (tripId, userId, role) =>
      run(tripId, async () => {
        const space = get().byTrip[tripId]?.space;
        if (space) await requireOnline().api.setRole(space.cloudTripId, userId, role);
        await get().sync(tripId);
      }),

    removeMember: (tripId, userId) =>
      run(tripId, async () => {
        const space = get().byTrip[tripId]?.space;
        if (space) await requireOnline().api.removeMember(space.cloudTripId, userId);
        await get().sync(tripId);
      }),

    transfer: (tripId, userId) =>
      run(tripId, async () => {
        const space = get().byTrip[tripId]?.space;
        if (space) await requireOnline().api.transfer(space.cloudTripId, userId);
        await get().sync(tripId);
      }),

    stop: (tripId) =>
      run(tripId, async () => {
        const { api } = requireOnline();
        await stopSharing(tripId, { api, repos: await getRepositories() });
        put(tripId, { invites: null });
      }),

    async join(token) {
      const { api, account } = requireOnline();
      const joined = await joinTrip(token, account, { api, repos: await getRepositories() });
      await get().sync(joined.tripId);
      return joined.tripId;
    },

    async entryChanged(tripId, entryId) {
      const { sharing } = await getRepositories();
      if (await sharing.enqueue(tripId, entryId)) {
        await refreshLocal(tripId);
        void get().sync(tripId);
      }
    },
  };
}));

export function useTripSharing(tripId: string | undefined): TripSharing {
  return useSharingStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? EMPTY);
}
