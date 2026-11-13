import { accountScoped } from '@/lib/accountScopedStores';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { useAuthStore } from '@/features/auth/authStore';
import { activePartition } from '@/db/client';
import { partitionFor } from '@/db/partitions';
import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage, imageExists, isManagedImageUri, readImageBytes } from '@/lib/imageStore';

import { driveConnection, driveToken, isDriveConfigured } from './driveAuth';
import { createDriveClient, DRIVE_ERROR_MESSAGES } from './driveClient';
import type { UploadCounts, UploadSource } from './photoUploadRepository';
import { freeDeviceCopies, runUploads, uploadFileName, type PauseReason } from './photoUploader';

/**
 * Automatic upload of selected photos to the user's own Google Drive.
 * Selecting a photo queues it immediately (on the device) and starts an
 * upload; the queue survives restarts and resumes when the app is open again,
 * the connection is back or Drive is reconnected.
 */

interface PhotoUploadState {
  counts: UploadCounts;
  /** Photos picked before Drive was connected (not queued). */
  unqueued: number;
  autoUpload: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  paused: PauseReason | null;
  /** The queue row being uploaded right now. */
  uploadingId: string | null;
  error: string | null;
  /** Bumped after every change so photo badges refresh. */
  version: number;
  refresh: () => Promise<void>;
  /** Called right after the user picks a photo. Returns whether it was queued for Drive. */
  photoSelected: (input: { tripId: string; source: UploadSource; sourceId: string; uri: string }) => Promise<boolean>;
  /** Called when the user removes a photo from Trip Prep (the Drive original stays). */
  photoRemoved: (uris: readonly string[]) => Promise<void>;
  process: () => Promise<void>;
  /** Queues photos picked before Drive was connected. */
  queueExisting: () => Promise<number>;
  retry: () => Promise<void>;
  setAutoUpload: (on: boolean) => Promise<void>;
  /** Removes device copies of photos already in Drive (Android/iOS). Returns how many. */
  freeUpSpace: () => Promise<number>;
}

const accountId = () => useAuthStore.getState().user?.id ?? null;
let running: Promise<void> | null = null;

/** Drive is set up, the user is signed in and has connected Drive (even if the token needs renewing). */
async function connectedAccount(): Promise<string | null> {
  const id = accountId();
  // Photos are only queued and uploaded from the signed-in account's own data.
  if (!isDriveConfigured() || !id || activePartition() !== partitionFor(id)) return null;
  return (await driveConnection(id)) ? id : null;
}

export const usePhotoUploadStore = accountScoped(create<PhotoUploadState>()((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }));

  async function refreshCounts() {
    const { photoUploads } = await getRepositories();
    const id = accountId();
    set({
      counts: id ? await photoUploads.counts(id) : { pending: 0, failed: 0, uploaded: 0 },
      unqueued: id ? (await photoUploads.unqueued(id)).length : 0,
      autoUpload: await photoUploads.autoUpload(),
    });
  }

  return {
    counts: { pending: 0, failed: 0, uploaded: 0 },
    unqueued: 0,
    autoUpload: true,
    running: false,
    progress: null,
    paused: null,
    uploadingId: null,
    error: null,
    version: 0,

    refresh: () => refreshCounts().catch(() => undefined),

    async photoSelected({ tripId, source, sourceId, uri }) {
      const id = await connectedAccount();
      const { photoUploads } = await getRepositories();
      if (!id || !(await photoUploads.autoUpload())) return false;
      const fileName = uploadFileName(source, sourceId, uri, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
      await photoUploads.enqueue({ accountId: id, tripId, source, sourceId, localUri: uri, fileName });
      await refreshCounts();
      bump();
      void get().process();
      return true;
    },

    async photoRemoved(uris) {
      const { photoUploads } = await getRepositories();
      for (const uri of uris) for (const cache of await photoUploads.removeByUri(uri)) deleteStoredImage(cache);
      await refreshCounts();
      bump();
    },

    process() {
      if (running) return running;
      running = (async () => {
        const id = await connectedAccount();
        if (!id) return;
        set({ running: true, error: null });
        try {
          const { photoUploads, journal } = await getRepositories(partitionFor(id));
          const result = await runUploads(id, {
            client: createDriveClient(() => driveToken(id)),
            uploads: photoUploads,
            journal,
            readPhoto: readImageBytes,
            onProgress: (done, total) => {
              set({ progress: { done, total } });
              bump();
            },
            onItem: (uploadingId) => {
              set({ uploadingId });
              bump();
            },
          });
          set({ paused: result.paused, error: result.paused ? (result.paused === 'offline' ? null : DRIVE_ERROR_MESSAGES[result.paused]) : null });
        } catch (error) {
          set({ error: toErrorMessage(error, 'Photo upload stopped.') });
        } finally {
          set({ running: false, progress: null, uploadingId: null });
          await refreshCounts().catch(() => undefined);
          bump();
        }
      })().finally(() => {
        running = null;
      });
      return running;
    },

    async queueExisting() {
      const id = await connectedAccount();
      if (!id) return 0;
      const { photoUploads } = await getRepositories();
      const items = await photoUploads.unqueued(id);
      for (const item of items) {
        await photoUploads.enqueue({ accountId: id, ...item, fileName: uploadFileName(item.source, item.sourceId, item.localUri, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`) });
      }
      await refreshCounts();
      bump();
      void get().process();
      return items.length;
    },

    async retry() {
      const id = accountId();
      if (!id) return;
      const { photoUploads } = await getRepositories();
      await photoUploads.retryAll(id);
      set({ paused: null, error: null });
      await get().process();
    },

    async setAutoUpload(on) {
      const { photoUploads } = await getRepositories();
      await photoUploads.setAutoUpload(on);
      set({ autoUpload: on });
    },

    async freeUpSpace() {
      const id = accountId();
      if (!id || Platform.OS === 'web') return 0;
      const { photoUploads } = await getRepositories();
      const removed = await freeDeviceCopies(id, { uploads: photoUploads, exists: imageExists, remove: deleteStoredImage, removable: isManagedImageUri });
      bump();
      return removed;
    },
  };
}));
