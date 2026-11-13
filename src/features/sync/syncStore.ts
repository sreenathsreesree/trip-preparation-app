import { accountScoped } from '@/lib/accountScopedStores';
import { create } from 'zustand';

import { activePartition, getPartitionDatabase } from '@/db/client';
import { partitionFor } from '@/db/partitions';
import { useAuthStore } from '@/features/auth/authStore';
import { getSupabase, isCloudConfigured } from '@/features/auth/supabase';
import { toErrorMessage } from '@/lib/errors';
import { createId } from '@/lib/id';

import { useTripsStore } from '../trips/tripsStore';
import { createSupabaseSyncApi } from './syncApi';
import { backupStatus, deviceDataSummary, isSyncAccountError, linkAccount, linkedAccount, resolveConflicts, runSync, type SyncResult } from './syncEngine';

export type BackupPhase =
  | 'unavailable' // no cloud in this build, or signed out
  | 'needs_choice' // signed in, this phone has data that is not linked to any account yet
  | 'other_account' // this phone's data belongs to a different account
  | 'ready';

interface SyncState {
  phase: BackupPhase;
  running: boolean;
  lastResult: SyncResult | null;
  lastSyncAt: string | null;
  pending: number | null;
  conflicts: number;
  photosNotInDrive: number;
  error: string | null;
  deviceSummary: { trips: number; journalEntries: number; expenses: number; inventoryItems: number } | null;
  refresh: () => Promise<void>;
  /** The user agreed to keep this phone's data in their account. */
  adoptDeviceData: () => Promise<void>;
  syncNow: () => Promise<void>;
  resolve: (choice: 'keep_device' | 'use_cloud') => Promise<void>;
}

let running: Promise<void> | null = null;

const api = () => {
  const client = isCloudConfigured() ? getSupabase() : null;
  return client ? createSupabaseSyncApi(client) : null;
};

export const useSyncStore = accountScoped(create<SyncState>()((set, get) => {
  async function refreshStatus() {
    const user = useAuthStore.getState().user;
    // Only the signed-in account's own partition is ever backed up.
    if (!api() || !user || activePartition() !== partitionFor(user.id)) {
      set({ phase: 'unavailable' });
      return;
    }
    const db = await getPartitionDatabase(partitionFor(user.id));
    const linked = await linkedAccount(db);
    if (linked && linked !== user.id) {
      set({ phase: 'other_account' });
      return;
    }
    if (!linked) {
      const summary = await deviceDataSummary(db);
      const empty = summary.trips + summary.journalEntries + summary.expenses + summary.inventoryItems === 0;
      if (empty) {
        // A fresh install: link silently so the account's data simply appears.
        await linkAccount(db, user.id);
      } else {
        set({ phase: 'needs_choice', deviceSummary: summary });
        return;
      }
    }
    const status = await backupStatus(db, []);
    set({ phase: 'ready', lastSyncAt: status.lastSyncAt, conflicts: status.conflicts });
  }

  return {
    phase: 'unavailable',
    running: false,
    lastResult: null,
    lastSyncAt: null,
    pending: null,
    conflicts: 0,
    photosNotInDrive: 0,
    error: null,
    deviceSummary: null,

    refresh: () => refreshStatus().catch((e: unknown) => set({ error: toErrorMessage(e, 'Could not read the backup status.') })),

    async adoptDeviceData() {
      const user = useAuthStore.getState().user;
      if (!user) return;
      await linkAccount(await getPartitionDatabase(partitionFor(user.id)), user.id);
      set({ phase: 'ready', deviceSummary: null });
      await get().syncNow();
    },

    syncNow() {
      if (running) return running;
      running = (async () => {
        const client = api();
        const user = useAuthStore.getState().user;
        if (!client || !user) return;
        await refreshStatus();
        if (get().phase !== 'ready') return;
        set({ running: true, error: null });
        try {
          // Bound to this user's own database even if the account switches mid-run.
          const db = await getPartitionDatabase(partitionFor(user.id));
          const result = await runSync(db, client, { accountId: user.id, createId });
          set({ lastResult: result, lastSyncAt: new Date().toISOString(), pending: result.pending, conflicts: result.conflicts, photosNotInDrive: result.photosNotInDrive });
          if (result.downloaded > 0 && activePartition() === partitionFor(user.id)) await useTripsStore.getState().load();
        } catch (error) {
          set({ error: isSyncAccountError(error) ? error.message : toErrorMessage(error, 'Backup didn’t finish. It will try again.') });
        } finally {
          set({ running: false });
        }
      })().finally(() => {
        running = null;
      });
      return running;
    },

    async resolve(choice) {
      const user = useAuthStore.getState().user;
      if (!user || activePartition() !== partitionFor(user.id)) return;
      await resolveConflicts(await getPartitionDatabase(partitionFor(user.id)), choice);
      set({ conflicts: 0 });
      await get().syncNow();
      await useTripsStore.getState().load();
    },
  };
}));
