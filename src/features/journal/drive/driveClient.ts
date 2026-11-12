/**
 * Minimal Google Drive v3 client for the journal backup.
 *
 * Uses the `drive.file` scope: Trip Prep can only see and change files it
 * created itself, never the rest of the user's Drive. Every file it creates
 * carries `appProperties.tripprep = "1"` so backups are found by query, not by
 * browsing. The access token is supplied per call and never stored here.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const APP_TAG = { tripprep: '1' } as const;

export type DriveErrorKind = 'auth' | 'not_enabled' | 'denied' | 'storage_full' | 'rate_limited' | 'not_found' | 'network' | 'unknown';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message?: string,
  ) {
    super(message ?? DRIVE_ERROR_MESSAGES[kind]);
    this.name = 'DriveError';
  }
}

export const DRIVE_ERROR_MESSAGES: Record<DriveErrorKind, string> = {
  auth: 'Your Google Drive connection has expired. Reconnect to continue.',
  not_enabled: 'Google Drive isn’t enabled for Trip Prep yet.',
  denied: 'Trip Prep doesn’t have permission to use Google Drive. Reconnect and allow access.',
  storage_full: 'Your Google Drive is full.',
  rate_limited: 'Google Drive is busy. Try again in a minute.',
  not_found: 'That file is no longer in Google Drive.',
  network: 'Couldn’t reach Google Drive. Check your connection and try again.',
  unknown: 'Google Drive returned an error. Try again later.',
};

export const isDriveError = (e: unknown): e is DriveError => e instanceof DriveError;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  appProperties: Record<string, string>;
  modifiedTime?: string;
}

export interface DriveClient {
  list(properties: Record<string, string>): Promise<DriveFile[]>;
  createFolder(name: string, parentId: string | null, properties: Record<string, string>): Promise<string>;
  /** Creates (no `fileId`) or replaces the content of a file. Returns its id. */
  upload(input: {
    fileId?: string | null;
    name: string;
    mimeType: string;
    parentId: string;
    properties: Record<string, string>;
    body: string | Uint8Array;
  }): Promise<string>;
  downloadText(fileId: string): Promise<string>;
  downloadBytes(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

async function toError(response: Response): Promise<DriveError> {
  let reason = '';
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  } catch {
    reason = '';
  }
  if (response.status === 401) return new DriveError('auth');
  if (response.status === 404) return new DriveError('not_found');
  if (response.status === 429 || /rateLimit/i.test(reason)) return new DriveError('rate_limited');
  if (response.status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return new DriveError('not_enabled');
    if (/storageQuotaExceeded/i.test(reason)) return new DriveError('storage_full');
    return new DriveError('denied');
  }
  return new DriveError('unknown');
}

const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createDriveClient(getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): DriveClient {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    } catch {
      throw new DriveError('network');
    }
    if (!response.ok) throw await toError(response);
    return response;
  }

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });

  return {
    async list(properties) {
      const clauses = Object.entries({ ...APP_TAG, ...properties }).map(
        ([key, value]) => `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' }`,
      );
      const params = new URLSearchParams({
        q: [...clauses, 'trashed = false'].join(' and '),
        spaces: 'drive',
        pageSize: '1000',
        fields: 'files(id,name,mimeType,appProperties,modifiedTime)',
      });
      const body = (await (await call(`${API}/files?${params.toString()}`)).json()) as { files?: DriveFile[] };
      return (body.files ?? []).map((f) => ({ ...f, appProperties: f.appProperties ?? {} }));
    },

    async createFolder(name, parentId, properties) {
      const response = await call(
        `${API}/files?fields=id`,
        json({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties: { ...APP_TAG, ...properties } }),
      );
      return ((await response.json()) as { id: string }).id;
    },

    async upload({ fileId, name, mimeType, parentId, properties, body }) {
      let id = fileId ?? null;
      if (!id) {
        const created = await call(`${API}/files?fields=id`, json({ name, mimeType, parents: [parentId], appProperties: { ...APP_TAG, ...properties } }));
        id = ((await created.json()) as { id: string }).id;
      }
      await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: body as BodyInit,
      });
      return id;
    },

    async downloadText(fileId) {
      return (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).text();
    },

    async downloadBytes(fileId) {
      const response = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
      return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get('Content-Type') ?? 'image/jpeg' };
    },
  };
}
