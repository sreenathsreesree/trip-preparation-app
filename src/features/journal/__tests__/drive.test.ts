import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { backupTrip, contentHash, listBackups, restoreBackup } from '../drive/driveBackup';
import { fakeDrive } from '../../../../test/fakeDrive';
import { createDriveClient } from '../drive/driveClient';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Kerala', destinations: [], startDate: '2026-12-20', endDate: '2026-12-24' }), { sections: [] });
  const a = await repos.journal.create(trip.id, { entryDate: '2026-12-20', title: 'Arrival', body: 'Rain' });
  await repos.journal.addPhoto(a.id, 'file:///one.jpg', 'Station');
  await repos.journal.create(trip.id, { entryDate: '2026-12-21', title: 'Tea hills' });
  const readPhoto = jest.fn(async (uri: string) => {
    if (uri.includes('missing')) throw new Error('gone');
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
  });
  return { ...repos, trip, a, readPhoto };
}

describe('Google Drive backup', () => {
  it('creates the folders once, uploads everything once, then only what changed', async () => {
    const ctx = await setup();
    const drive = fakeDrive();
    const deps = { client: drive.client, repo: ctx.journal, readPhoto: ctx.readPhoto };

    expect(await backupTrip(ctx.trip, deps)).toEqual({ photosUploaded: 1, photosSkipped: 0, journalUploaded: true, photosMissing: 0 });
    const names = [...drive.files.values()].map((f) => f.name).sort();
    expect(names).toEqual(['Kerala (2026-12-20)', 'Trip Prep', 'journal.json', `photo-${(await ctx.journal.get(ctx.a.id))?.photos[0]?.id}.jpg`].sort());

    // Nothing changed: no uploads, no new folders.
    const before = { ...drive.calls };
    expect(await backupTrip(ctx.trip, deps)).toMatchObject({ photosUploaded: 0, photosSkipped: 1, journalUploaded: false });
    expect(drive.calls).toEqual(before);

    // An edit re-uploads the journal only, replacing the same file.
    await ctx.journal.update(ctx.a.id, { entryDate: '2026-12-20', title: 'Arrival', body: 'Heavy rain' });
    expect(await backupTrip(ctx.trip, deps)).toMatchObject({ photosUploaded: 0, journalUploaded: true });
    expect([...drive.files.values()].filter((f) => f.name === 'journal.json')).toHaveLength(1);
  });

  it('recreates a journal file the user deleted from Drive, and reports unreadable photos', async () => {
    const ctx = await setup();
    const drive = fakeDrive();
    const deps = { client: drive.client, repo: ctx.journal, readPhoto: ctx.readPhoto };
    await backupTrip(ctx.trip, deps);
    const journalId = [...drive.files.values()].find((f) => f.name === 'journal.json')?.id as string;
    drive.files.delete(journalId);
    await ctx.journal.addPhoto(ctx.a.id, 'file:///missing.jpg');
    const result = await backupTrip(ctx.trip, deps);
    expect(result).toMatchObject({ journalUploaded: true, photosMissing: 1 });
    expect([...drive.files.values()].some((f) => f.name === 'journal.json')).toBe(true);
  });

  it('restores into another trip (another device): adds entries and photos, never overwrites', async () => {
    const ctx = await setup();
    const drive = fakeDrive();
    await backupTrip(ctx.trip, { client: drive.client, repo: ctx.journal, readPhoto: ctx.readPhoto });

    const device2 = await setupRepositories();
    const trip2 = await device2.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
    const backups = await listBackups(drive.client);
    expect(backups.map((b) => [b.tripName, b.tripId])).toEqual([['Kerala', ctx.trip.id]]);

    const savePhoto = jest.fn(async () => 'file:///restored.jpg');
    const result = await restoreBackup(trip2.id, backups[0]?.fileId as string, { client: drive.client, repo: device2.journal, savePhoto });
    expect(result).toEqual({ entriesAdded: 2, photosAdded: 1, conflicts: 0, unchanged: 0, photosMissing: 0 });
    const restored = await device2.journal.list(trip2.id);
    expect(restored.map((e) => e.title).sort()).toEqual(['Arrival', 'Tea hills']);
    expect(restored.find((e) => e.title === 'Arrival')?.photos.map((p) => [p.uri, p.caption])).toEqual([['file:///restored.jpg', 'Station']]);
    expect(restored.every((e) => e.visibility === 'private')).toBe(true);

    // Edited on device 2, restored again: kept as is, reported, nothing duplicated.
    const arrival = restored.find((e) => e.title === 'Arrival') as (typeof restored)[number];
    await device2.journal.update(arrival.id, { entryDate: arrival.entryDate, title: 'Arrival', body: 'Edited here' });
    const again = await restoreBackup(trip2.id, backups[0]?.fileId as string, { client: drive.client, repo: device2.journal, savePhoto });
    expect(again).toEqual({ entriesAdded: 0, photosAdded: 0, conflicts: 1, unchanged: 1, photosMissing: 0 });
    expect((await device2.journal.get(arrival.id))?.body).toBe('Edited here');
  });

  it('rejects a file that is not a journal backup', async () => {
    const ctx = await setup();
    const drive = fakeDrive();
    const id = await drive.client.upload({ name: 'x.json', mimeType: 'application/json', parentId: 'p', properties: { kind: 'journal' }, body: '{"hello":1}' });
    await expect(restoreBackup(ctx.trip.id, id, { client: drive.client, repo: ctx.journal, savePhoto: jest.fn() })).rejects.toThrow(/isn’t a Trip Prep journal backup/);
  });

  it('fingerprints content', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});

describe('Drive HTTP client', () => {
  const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      arrayBuffer: async () => new Uint8Array([9]).buffer,
      headers: { get: (k: string) => headers[k] ?? null },
    }) as unknown as Response;

  it('sends the token, queries only its own files and uploads in two steps', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url.includes('/files?q=')) return response(200, { files: [{ id: 'x', name: 'journal.json', mimeType: 'application/json' }] });
      if (url.includes('upload/drive')) return response(200, { id: 'new' });
      return response(200, { id: 'new' });
    });
    const client = createDriveClient(async () => 'tok', fetchMock as unknown as typeof fetch);
    const files = await client.list({ kind: 'journal' });
    expect(files).toEqual([{ id: 'x', name: 'journal.json', mimeType: 'application/json', appProperties: {} }]);
    const listUrl = new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get('q') ?? '';
    expect(listUrl).toContain("appProperties has { key='tripprep' and value='1' }");
    expect(listUrl).toContain("appProperties has { key='kind' and value='journal' }");
    expect(listUrl).toContain('trashed = false');
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok');

    await client.upload({ name: 'a.json', mimeType: 'application/json', parentId: 'p', properties: {}, body: '{}' });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://www.googleapis.com/upload/drive/v3/files/new?uploadType=media&fields=id');
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH');
  });

  it('maps failures to clear reasons', async () => {
    const cases: [Response | Error, string][] = [
      [response(401), 'auth'],
      [response(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }), 'not_enabled'],
      [response(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }), 'storage_full'],
      [response(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), 'rate_limited'],
      [response(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }), 'denied'],
      [response(404), 'not_found'],
      [new TypeError('Network request failed'), 'network'],
    ];
    for (const [result, kind] of cases) {
      const fetchMock = jest.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      });
      const client = createDriveClient(async () => 'tok', fetchMock as unknown as typeof fetch);
      await expect(client.downloadText('id')).rejects.toMatchObject({ kind });
    }
  });
});
