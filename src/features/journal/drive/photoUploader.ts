import type { JournalRepository } from '../journalRepository';
import { DriveError, type DriveClient } from './driveClient';
import { ensureTripFolder, forgetFolders } from './driveBackup';
import type { PhotoUpload, PhotoUploadRepository, UploadSource } from './photoUploadRepository';

/**
 * Uploads queued photos to the user's own Google Drive, one at a time, oldest
 * first. Photos go into the trip's "Trip Prep" folder; the queue keeps the
 * Drive file id as the photo's reference. Nothing is sent anywhere else.
 *
 * - Offline / busy / server errors: the photo stays queued and is retried with
 *   growing gaps (1, 2, 5, 15, 30, 60 minutes); after 8 tries it waits for the
 *   user's Retry so a broken photo does not retry forever.
 * - Expired or revoked connection, Drive API off, Drive full: the run pauses
 *   with that reason and nothing is marked failed; uploads resume after the
 *   user reconnects / fixes it.
 * - The device copy is gone: that photo fails (nothing to upload).
 */

export const RETRY_DELAYS_MIN = [1, 2, 5, 15, 30, 60] as const;
export const MAX_AUTOMATIC_ATTEMPTS = 8;

export type PauseReason = 'auth' | 'not_enabled' | 'storage_full';

export interface UploadRunResult {
  uploaded: number;
  retrying: number;
  failed: number;
  paused: PauseReason | null;
}

export interface UploaderDeps {
  client: DriveClient;
  uploads: PhotoUploadRepository;
  journal: JournalRepository;
  readPhoto: (uri: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
}

export function nextAttempt(attempts: number, from: Date): Date {
  const minutes = RETRY_DELAYS_MIN[Math.min(attempts, RETRY_DELAYS_MIN.length - 1)] as number;
  return new Date(from.getTime() + minutes * 60_000);
}

/** File name in Drive: readable and unique per photo. */
export function uploadFileName(source: UploadSource, sourceId: string, uri: string, id: string): string {
  const ext = /^data:image\/(png|webp|jpeg)/.exec(uri)?.[1] ?? /\.(jpe?g|png|webp|heic)$/i.exec(uri)?.[1]?.toLowerCase() ?? 'jpg';
  const clean = ext === 'jpeg' ? 'jpg' : ext;
  return source === 'journal' ? `photo-${sourceId}.${clean}` : `memory-${sourceId.slice(0, 12)}-${id.slice(0, 8)}.${clean}`;
}

async function uploadOne(item: PhotoUpload, deps: UploaderDeps): Promise<string> {
  // A journal photo already uploaded by a manual backup is not uploaded twice.
  if (item.source === 'journal') {
    const record = await deps.journal.driveRecord('photo', item.sourceId);
    if (record) return record.driveFileId;
  }
  const trip = await deps.uploads.tripInfo(item.tripId);
  if (!trip) throw new Error('The trip no longer exists.');
  const content = await deps.readPhoto(item.localUri).catch(() => null);
  if (!content) throw new LocalPhotoMissing();
  const upload = async () =>
    deps.client.upload({
      name: item.fileName,
      mimeType: content.mimeType,
      parentId: await ensureTripFolder(trip, { client: deps.client, repo: deps.journal }),
      properties: { kind: item.source === 'journal' ? 'photo' : 'memory-photo', tripId: item.tripId, localId: item.source === 'journal' ? item.sourceId : item.id, sourceId: item.sourceId },
      body: content.bytes,
    });
  try {
    return await upload();
  } catch (error) {
    // The user deleted the trip folder in Drive: forget it and upload into a new one.
    if (error instanceof DriveError && error.kind === 'not_found') {
      await forgetFolders(deps.journal, item.tripId);
      return upload();
    }
    throw error;
  }
}

class LocalPhotoMissing extends Error {
  constructor() {
    super('The photo is no longer on this device.');
  }
}

/** Uploads everything due for `accountId`. Safe to call often; callers keep one run at a time. */
export async function runUploads(accountId: string, deps: UploaderDeps): Promise<UploadRunResult> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.uploads.due(accountId, now());
  const result: UploadRunResult = { uploaded: 0, retrying: 0, failed: 0, paused: null };
  let done = 0;
  for (const item of due) {
    try {
      const driveFileId = await uploadOne(item, deps);
      await deps.uploads.markUploaded(item.id, driveFileId);
      if (item.source === 'journal') {
        await deps.journal.saveDriveRecord({ kind: 'photo', localId: item.sourceId, driveFileId, contentHash: item.sourceId });
      }
      result.uploaded += 1;
    } catch (error) {
      if (error instanceof LocalPhotoMissing) {
        await deps.uploads.markFailed(item.id, error.message);
        result.failed += 1;
      } else if (error instanceof DriveError && (error.kind === 'auth' || error.kind === 'denied')) {
        result.paused = 'auth';
        break;
      } else if (error instanceof DriveError && (error.kind === 'not_enabled' || error.kind === 'storage_full')) {
        result.paused = error.kind;
        break;
      } else {
        const message = error instanceof Error ? error.message : 'Upload failed.';
        if (item.attempts + 1 >= MAX_AUTOMATIC_ATTEMPTS) {
          await deps.uploads.markFailed(item.id, message);
          result.failed += 1;
        } else {
          await deps.uploads.markRetry(item.id, message, nextAttempt(item.attempts, now()));
          result.retrying += 1;
        }
      }
    }
    deps.onProgress?.(++done, due.length);
  }
  return result;
}

export interface DisplayDeps {
  uploads: Pick<PhotoUploadRepository, 'findUploaded' | 'setCache'>;
  client: Pick<DriveClient, 'downloadBytes'> | null;
  exists: (uri: string) => boolean;
  savePhoto: (bytes: Uint8Array, mimeType: string) => Promise<string>;
}

/**
 * The image to show for a photo: the device copy when it is there, else a
 * copy downloaded from the user's Drive (kept as a cache), else null with the
 * reason, so the screen can say "in your Google Drive — reconnect to view".
 */
export async function resolvePhoto(uri: string, deps: DisplayDeps): Promise<{ uri: string | null; from: 'device' | 'drive' | null; reason?: 'offline' | 'not_uploaded' }> {
  if (deps.exists(uri)) return { uri, from: 'device' };
  const upload = await deps.uploads.findUploaded(uri);
  if (!upload?.driveFileId) return { uri: null, from: null, reason: 'not_uploaded' };
  if (upload.cacheUri && deps.exists(upload.cacheUri)) return { uri: upload.cacheUri, from: 'drive' };
  if (!deps.client) return { uri: null, from: null, reason: 'offline' };
  try {
    const { bytes, mimeType } = await deps.client.downloadBytes(upload.driveFileId);
    const cached = await deps.savePhoto(bytes, mimeType);
    await deps.uploads.setCache(upload.id, cached);
    return { uri: cached, from: 'drive' };
  } catch {
    return { uri: null, from: null, reason: 'offline' };
  }
}

/**
 * Removes device copies of photos that are safely in Drive (they then show
 * from Drive). Returns how many copies were removed.
 */
export async function freeDeviceCopies(
  accountId: string,
  deps: { uploads: Pick<PhotoUploadRepository, 'uploaded'>; exists: (uri: string) => boolean; remove: (uri: string) => void; removable: (uri: string) => boolean },
): Promise<number> {
  let removed = 0;
  for (const item of await deps.uploads.uploaded(accountId)) {
    if (item.driveFileId && deps.removable(item.localUri) && deps.exists(item.localUri)) {
      deps.remove(item.localUri);
      removed += 1;
    }
  }
  return removed;
}
