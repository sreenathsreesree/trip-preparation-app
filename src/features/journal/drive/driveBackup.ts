import type { JournalRepository } from '../journalRepository';
import { parseBackup, photoFileName, planRestore, toBackup, type JournalBackup } from '../model';
import { DriveError, FOLDER_MIME, type DriveClient, type DriveFile } from './driveClient';

/**
 * Backup and restore of a trip's journal to the user's own Google Drive.
 *
 * Layout: "Trip Prep" folder → one folder per trip → `journal.json` plus one
 * file per photo. Backups upload only what changed (content hash for the
 * journal; photos are immutable, so once uploaded they are skipped). Restore is
 * additive: it never deletes or overwrites anything on the device.
 */

export const ROOT_FOLDER_NAME = 'Trip Prep';

/** FNV-1a: a fast content fingerprint (not security sensitive). */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface BackupDeps {
  client: DriveClient;
  repo: JournalRepository;
  readPhoto: (uri: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
}

export interface BackupResult {
  photosUploaded: number;
  photosSkipped: number;
  journalUploaded: boolean;
  /** Photos that could not be read on this device (left out, reported). */
  photosMissing: number;
}

/** Drive's appProperties values are short; keep names well inside the limit. */
const short = (value: string) => value.slice(0, 60);

async function folder(deps: Pick<BackupDeps, 'client' | 'repo'>, localId: string, name: string, parentId: string | null, properties: Record<string, string>) {
  const record = await deps.repo.driveRecord('folder', localId);
  if (record) return record.driveFileId;
  const existing = (await deps.client.list({ ...properties })).find((f) => f.mimeType === FOLDER_MIME);
  const id = existing?.id ?? (await deps.client.createFolder(name, parentId, properties));
  await deps.repo.saveDriveRecord({ kind: 'folder', localId, driveFileId: id, contentHash: '' });
  return id;
}

/** Uploads, recreating the file if the user deleted it from Drive since the last backup. */
async function uploadOrRecreate(client: DriveClient, input: Parameters<DriveClient['upload']>[0]): Promise<string> {
  try {
    return await client.upload(input);
  } catch (error) {
    if (error instanceof DriveError && error.kind === 'not_found' && input.fileId) return client.upload({ ...input, fileId: null });
    throw error;
  }
}

/** Drive folder names cannot be empty; keep them readable. */
const folderName = (name: string) => name.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Trip';

/**
 * The trip's folder in Drive ("Trip Prep" / "<trip name>"), created once and
 * remembered by id. Folders are found again by their app properties (never by
 * name), so a reconnect or reinstall reuses them; folders made by earlier
 * versions ("<trip> (<start>)") are reused as they are, never renamed or moved.
 */
export async function ensureTripFolder(trip: { id: string; name: string; startDate: string }, deps: Pick<BackupDeps, 'client' | 'repo'>): Promise<string> {
  const root = await folder(deps, 'root', ROOT_FOLDER_NAME, null, { kind: 'root' });
  return folder(deps, trip.id, folderName(trip.name), root, { kind: 'trip', tripId: trip.id, tripName: short(trip.name) });
}

export const MEMORIES_FOLDER_NAME = 'Memories';

/** "Trip Prep" / "<trip name>" / "Memories": where photos go. Created once per trip and remembered. */
export async function ensureMemoriesFolder(trip: { id: string; name: string; startDate: string }, deps: Pick<BackupDeps, 'client' | 'repo'>): Promise<string> {
  const tripFolder = await ensureTripFolder(trip, deps);
  return folder(deps, `${trip.id}:memories`, MEMORIES_FOLDER_NAME, tripFolder, { kind: 'memories', tripId: trip.id });
}

/** Forgets remembered folders (after the user deleted them in Drive). Nothing in Drive is touched. */
export async function forgetFolders(repo: JournalRepository, tripId: string): Promise<void> {
  await repo.forgetDriveRecord('folder', `${tripId}:memories`);
  await repo.forgetDriveRecord('folder', tripId);
  await repo.forgetDriveRecord('folder', 'root');
}

export async function backupTrip(trip: { id: string; name: string; startDate: string }, deps: BackupDeps): Promise<BackupResult> {
  const now = deps.now ?? (() => new Date());
  const entries = await deps.repo.list(trip.id);
  const tripFolder = await ensureTripFolder(trip, deps);

  const photos = entries.flatMap((e) => e.photos);
  const result: BackupResult = { photosUploaded: 0, photosSkipped: 0, journalUploaded: false, photosMissing: 0 };
  const total = photos.length + 1;
  let done = 0;
  for (const photo of photos) {
    const record = await deps.repo.driveRecord('photo', photo.id);
    if (record) {
      result.photosSkipped += 1;
    } else {
      let content: { bytes: Uint8Array; mimeType: string } | null = null;
      try {
        content = await deps.readPhoto(photo.uri);
      } catch {
        result.photosMissing += 1;
      }
      if (content) {
        const id = await deps.client.upload({
          name: photoFileName(photo),
          mimeType: content.mimeType,
          parentId: tripFolder,
          properties: { kind: 'photo', tripId: trip.id, localId: photo.id },
          body: content.bytes,
        });
        await deps.repo.saveDriveRecord({ kind: 'photo', localId: photo.id, driveFileId: id, contentHash: photo.id });
        result.photosUploaded += 1;
      }
    }
    deps.onProgress?.(++done, total);
  }

  const backup = toBackup(trip, entries, now().toISOString());
  const hash = contentHash(JSON.stringify({ ...backup, exportedAt: '' }));
  const record = await deps.repo.driveRecord('journal', trip.id);
  if (!record || record.contentHash !== hash) {
    const id = await uploadOrRecreate(deps.client, {
      fileId: record?.driveFileId ?? null,
      name: 'journal.json',
      mimeType: 'application/json',
      parentId: tripFolder,
      properties: { kind: 'journal', tripId: trip.id, tripName: short(trip.name) },
      body: JSON.stringify(backup, null, 1),
    });
    await deps.repo.saveDriveRecord({ kind: 'journal', localId: trip.id, driveFileId: id, contentHash: hash });
    result.journalUploaded = true;
  }
  deps.onProgress?.(total, total);
  return result;
}

/** Journal backups in the user's Drive (any trip), newest first. */
export async function listBackups(client: DriveClient): Promise<{ fileId: string; tripId: string; tripName: string; modifiedTime: string | null }[]> {
  const files = await client.list({ kind: 'journal' });
  return files
    .map((f: DriveFile) => ({ fileId: f.id, tripId: f.appProperties.tripId ?? '', tripName: f.appProperties.tripName ?? f.name, modifiedTime: f.modifiedTime ?? null }))
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
}

export interface RestoreResult {
  entriesAdded: number;
  photosAdded: number;
  conflicts: number;
  unchanged: number;
  photosMissing: number;
}

/**
 * Adds what is missing on this device from a journal backup into `tripId`.
 * Entries that differ on both sides keep the device version (reported).
 */
export async function restoreBackup(
  tripId: string,
  backupFileId: string,
  deps: Omit<BackupDeps, 'readPhoto'> & { savePhoto: (bytes: Uint8Array, mimeType: string) => Promise<string> },
): Promise<RestoreResult> {
  let backup: JournalBackup | null = null;
  try {
    backup = parseBackup(JSON.parse(await deps.client.downloadText(backupFileId)));
  } catch (error) {
    if (error instanceof DriveError) throw error;
    backup = null;
  }
  if (!backup) throw new Error('That file isn’t a Trip Prep journal backup.');

  const plan = planRestore(await deps.repo.list(tripId), backup);
  const wanted = [...plan.add.flatMap((e) => e.photos.map((photo) => ({ entryId: e.id, photo }))), ...plan.addPhotos];
  const files = wanted.length > 0 ? await deps.client.list({ kind: 'photo', tripId: backup.tripId }) : [];
  const byLocalId = new Map(files.map((f) => [f.appProperties.localId, f.id]));

  const photos: { entryId: string; photo: (typeof wanted)[number]['photo']; uri: string }[] = [];
  let missing = 0;
  let done = 0;
  for (const item of wanted) {
    const fileId = byLocalId.get(item.photo.id);
    if (!fileId) {
      missing += 1;
    } else {
      const { bytes, mimeType } = await deps.client.downloadBytes(fileId);
      photos.push({ ...item, uri: await deps.savePhoto(bytes, mimeType) });
      await deps.repo.saveDriveRecord({ kind: 'photo', localId: item.photo.id, driveFileId: fileId, contentHash: item.photo.id });
    }
    deps.onProgress?.(++done, wanted.length);
  }
  const added = await deps.repo.importEntries(tripId, plan.add, photos);
  return { entriesAdded: added.entries, photosAdded: added.photos, conflicts: plan.conflicts.length, unchanged: plan.unchanged, photosMissing: missing };
}
