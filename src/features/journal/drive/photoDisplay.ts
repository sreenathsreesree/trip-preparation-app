import { getPartitionDatabase } from '@/db/client';
import { partitionFor } from '@/db/partitions';
import { getRepositories } from '@/db/repositories';
import { imageExists, saveImageBytes } from '@/lib/imageStore';

import { driveToken } from './driveAuth';
import { createDriveClient } from './driveClient';
import type { PhotoUploadRepository } from './photoUploadRepository';
import type { DisplayDeps } from './photoUploader';

/**
 * What resolving a photo for display needs, bound to one account's own
 * database and Drive token. Signed out, there is no Drive client at all, so
 * nothing can be fetched with another account's token.
 */
export async function photoDisplayDeps(
  accountId: string | null,
): Promise<DisplayDeps & { uploads: PhotoUploadRepository; client: ReturnType<typeof createDriveClient> | null }> {
  const partition = partitionFor(accountId);
  const { photoUploads } = await getRepositories(partition);
  const db = await getPartitionDatabase(partition);
  return {
    uploads: photoUploads,
    exists: imageExists,
    savePhoto: saveImageBytes,
    client: accountId ? createDriveClient(() => driveToken(accountId)) : null,
    driveCache: {
      get: async (fileId) => (await db.getFirstAsync<{ local_uri: string }>('SELECT local_uri FROM drive_cache WHERE drive_file_id = ?', [fileId]))?.local_uri ?? null,
      set: async (fileId, local) => {
        await db.runAsync(
          'INSERT INTO drive_cache (drive_file_id, local_uri, cached_at) VALUES (?, ?, ?) ON CONFLICT (drive_file_id) DO UPDATE SET local_uri = excluded.local_uri, cached_at = excluded.cached_at',
          [fileId, local, new Date().toISOString()],
        );
      },
    },
  };
}
