import { DriveError, FOLDER_MIME, type DriveClient, type DriveFile } from '@/features/journal/drive/driveClient';

/** In-memory Drive with the same visibility rules as `drive.file`: only files this app created. */
export function fakeDrive() {
  const files = new Map<string, DriveFile & { parents: string[]; content: string | Uint8Array }>();
  let next = 1;
  const calls = { uploads: 0, folders: 0 };
  const client: DriveClient = {
    async list(properties) {
      const want = { tripprep: '1', ...properties };
      return [...files.values()].filter((f) => Object.entries(want).every(([k, v]) => f.appProperties[k] === v));
    },
    async createFolder(name, parentId, properties) {
      calls.folders += 1;
      const id = `f${next++}`;
      files.set(id, { id, name, mimeType: FOLDER_MIME, appProperties: { tripprep: '1', ...properties }, parents: parentId ? [parentId] : [], content: '' });
      return id;
    },
    async upload({ fileId, name, mimeType, parentId, properties, body }) {
      calls.uploads += 1;
      if (fileId && !files.has(fileId)) throw new DriveError('not_found');
      const id = fileId ?? `f${next++}`;
      files.set(id, { id, name, mimeType, appProperties: { tripprep: '1', ...properties }, parents: [parentId], content: body, modifiedTime: `2026-12-${String(next).padStart(2, '0')}` });
      return id;
    },
    async downloadText(fileId) {
      const f = files.get(fileId);
      if (!f) throw new DriveError('not_found');
      return f.content as string;
    },
    async downloadBytes(fileId) {
      const f = files.get(fileId);
      if (!f) throw new DriveError('not_found');
      return { bytes: f.content as Uint8Array, mimeType: f.mimeType };
    },
  };
  return { client, files, calls };
}
