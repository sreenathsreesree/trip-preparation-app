import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/authStore';
import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { readImageBytes, saveImageBytes } from '@/lib/imageStore';

import { useJournalStore } from '../journalStore';
import { connectDrive, disconnectDrive, driveConnection, driveToken, isDriveConfigured, isExpired, type DriveConnection } from './driveAuth';
import { backupTrip, listBackups, restoreBackup, type BackupResult, type RestoreResult } from './driveBackup';
import { createDriveClient, isDriveError } from './driveClient';

export type DriveStatus = 'unconfigured' | 'signedOut' | 'disconnected' | 'connected' | 'expired';

export interface BackupListItem {
  fileId: string;
  tripId: string;
  tripName: string;
  modifiedTime: string | null;
}

interface DriveState {
  connection: DriveConnection | null;
  busy: 'connect' | 'backup' | 'list' | 'restore' | null;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** Needs reconnecting (token expired or revoked). */
  needsReconnect: boolean;
  lastBackup: (BackupResult & { tripId: string; at: string }) | null;
  lastRestore: (RestoreResult & { tripId: string }) | null;
  backups: BackupListItem[] | null;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  backup: (trip: { id: string; name: string; startDate: string }) => Promise<void>;
  loadBackups: () => Promise<void>;
  restore: (tripId: string, fileId: string) => Promise<void>;
  clearMessages: () => void;
}

const currentUser = () => useAuthStore.getState().user;

function client() {
  const user = currentUser();
  return createDriveClient(() => driveToken(user?.id ?? null));
}

export const useDriveStore = create<DriveState>()((set, get) => {
  /** Runs a Drive task; a Drive auth error flips the card to "Reconnect". */
  async function task(kind: NonNullable<DriveState['busy']>, fn: () => Promise<void>) {
    if (get().busy) return;
    set({ busy: kind, error: null, progress: null });
    try {
      await fn();
    } catch (error) {
      const auth = isDriveError(error) && (error.kind === 'auth' || error.kind === 'denied');
      set({ error: toErrorMessage(error, 'Google Drive returned an error.'), needsReconnect: auth || get().needsReconnect });
    } finally {
      set({ busy: null, progress: null });
    }
  }
  const onProgress = (done: number, total: number) => set({ progress: { done, total } });

  return {
    connection: null,
    busy: null,
    progress: null,
    error: null,
    needsReconnect: false,
    lastBackup: null,
    lastRestore: null,
    backups: null,

    async refresh() {
      const connection = await driveConnection(currentUser()?.id ?? null);
      set({ connection, needsReconnect: connection ? isExpired(connection) : false });
    },

    connect: () =>
      task('connect', async () => {
        const user = currentUser();
        if (!user) throw new Error('Sign in with Google first.');
        const outcome = await connectDrive(user);
        if (outcome.status === 'error') throw new Error(outcome.message);
        if (outcome.status === 'connected') set({ connection: outcome.connection, needsReconnect: false });
      }),

    async disconnect() {
      await disconnectDrive();
      set({ connection: null, needsReconnect: false, backups: null, lastBackup: null, lastRestore: null, error: null });
    },

    backup: (trip) =>
      task('backup', async () => {
        const { journal } = await getRepositories();
        const result = await backupTrip(trip, { client: client(), repo: journal, readPhoto: readImageBytes, onProgress });
        set({ lastBackup: { ...result, tripId: trip.id, at: new Date().toISOString() } });
      }),

    loadBackups: () =>
      task('list', async () => {
        set({ backups: await listBackups(client()) });
      }),

    restore: (tripId, fileId) =>
      task('restore', async () => {
        const { journal } = await getRepositories();
        const result = await restoreBackup(tripId, fileId, { client: client(), repo: journal, savePhoto: saveImageBytes, onProgress });
        set({ lastRestore: { ...result, tripId } });
        await useJournalStore.getState().load(tripId);
      }),

    clearMessages: () => set({ error: null }),
  };
});

/** What the Drive card should show. */
export function useDriveStatus(): DriveStatus {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const connection = useDriveStore((s) => s.connection);
  const needsReconnect = useDriveStore((s) => s.needsReconnect);
  if (!isDriveConfigured()) return 'unconfigured';
  if (!signedIn) return 'signedOut';
  if (!connection) return 'disconnected';
  return needsReconnect ? 'expired' : 'connected';
}
