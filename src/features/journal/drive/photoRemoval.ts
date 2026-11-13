import { getRepositories } from '@/db/repositories';
import { confirmAction } from '@/lib/confirm';

import type { UploadStatus } from './photoUploadRepository';

/**
 * What removing a photo from Trip Prep means, by its Drive state. Removing
 * never touches Google Drive (Trip Prep cannot delete Drive files); it only
 * deletes Trip Prep's own copy, which matters when that copy is the only one.
 */
export function photoRemovalMessage(status: UploadStatus | null): { title: string; message: string; confirmLabel: string; destructive: boolean } {
  if (status === 'uploaded') {
    return {
      title: 'Remove this photo from Trip Prep?',
      message: 'The original stays in your Google Drive (Trip Prep folder). Only Trip Prep’s link and its copy on this phone are removed.',
      confirmLabel: 'Remove from Trip Prep',
      destructive: false,
    };
  }
  return {
    title: 'Remove this photo?',
    message:
      status === 'pending'
        ? 'It hasn’t finished uploading to Google Drive, so Trip Prep’s copy is the only one it has. Removing deletes that copy (a photo chosen from your gallery is still in your gallery).'
        : 'It isn’t in your Google Drive, so Trip Prep’s copy is the only one it has. Removing deletes that copy (a photo chosen from your gallery is still in your gallery).',
    confirmLabel: 'Remove photo',
    destructive: true,
  };
}

/** Asks before removing; resolves true when the user confirmed. */
export async function confirmPhotoRemoval(uri: string, accountId: string | null): Promise<boolean> {
  let status: UploadStatus | null = null;
  if (uri.startsWith('drive:')) status = 'uploaded';
  else if (accountId) {
    const { photoUploads } = await getRepositories();
    status = (await photoUploads.byUris(accountId, [uri])).get(uri)?.status ?? null;
  }
  return confirmAction(photoRemovalMessage(status));
}
