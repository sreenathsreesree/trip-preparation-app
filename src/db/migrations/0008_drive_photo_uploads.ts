import type { Migration } from '../migrate';

/**
 * Phase K correction: automatic upload of selected photos to the user's own
 * Google Drive. New table only.
 *
 * `drive_photo_uploads` is the on-device upload queue and, once uploaded, the
 * photo's Drive reference:
 * - one row per selected photo (`local_uri`) per Google account (`account_id`),
 *   so a photo is never uploaded to a different account's Drive after an
 *   account switch;
 * - `source` / `source_id`: a journal photo (journal_photos.id) or a
 *   destination memory (the place's node id);
 * - `status`: pending (waiting, retrying with `next_attempt_at`), uploaded
 *   (`drive_file_id` set) or failed (needs the user's retry);
 * - `cache_uri`: a copy downloaded from Drive when the original device copy
 *   was removed to free space.
 *
 * The photo itself never goes anywhere but the user's Drive. Removing a photo
 * from Trip Prep deletes the row; the original stays in Drive.
 */
export const drivePhotoUploads: Migration = {
  version: 8,
  name: 'drive_photo_uploads',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE drive_photo_uploads (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('journal', 'memory')),
        source_id TEXT NOT NULL,
        local_uri TEXT NOT NULL,
        cache_uri TEXT,
        file_name TEXT NOT NULL,
        drive_file_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        uploaded_at TEXT,
        CHECK (status <> 'uploaded' OR drive_file_id IS NOT NULL)
      );
      CREATE UNIQUE INDEX idx_drive_uploads_uri ON drive_photo_uploads (account_id, local_uri);
      CREATE INDEX idx_drive_uploads_due ON drive_photo_uploads (account_id, status, next_attempt_at);
    `);
  },
};
