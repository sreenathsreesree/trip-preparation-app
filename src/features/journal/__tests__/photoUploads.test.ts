import { fakeDrive } from '../../../../test/fakeDrive';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { backupTrip } from '../drive/driveBackup';
import { DriveError } from '../drive/driveClient';
import { freeDeviceCopies, MAX_AUTOMATIC_ATTEMPTS, resolvePhoto, runUploads, uploadDisplayState, uploadFileName } from '../drive/photoUploader';

const ME = 'account-me';
const OTHER = 'account-other';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Kerala', destinations: [], startDate: '2026-12-20', endDate: '2026-12-24' }), { sections: [] });
  const munnar = (await repos.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  const entry = await repos.journal.create(trip.id, { entryDate: '2026-12-20', title: 'Arrival' });
  const drive = fakeDrive();
  let clock = new Date('2026-12-20T10:00:00Z');
  const now = () => clock;
  const advance = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * 60_000);
  };
  const onDevice = new Set<string>();
  const readPhoto = jest.fn(async (uri: string) => {
    if (!onDevice.has(uri)) throw new Error('missing');
    return { bytes: new Uint8Array([7]), mimeType: 'image/jpeg' };
  });
  const deps = { client: drive.client, uploads: repos.photoUploads, journal: repos.journal, readPhoto, now };
  /** What the app does right after the user picks a photo. */
  const select = async (source: 'journal' | 'memory', sourceId: string, uri: string, accountId = ME) => {
    onDevice.add(uri);
    const id = `${source}-${sourceId}`;
    return repos.photoUploads.enqueue({ accountId, tripId: trip.id, source, sourceId, localUri: uri, fileName: uploadFileName(source, sourceId, uri, id) });
  };
  return { ...repos, trip, munnar, entry, drive, deps, select, advance, onDevice, now };
}

describe('automatic photo upload to the user’s Google Drive', () => {
  it('uploads a selected Memories photo and a journal photo into Trip Prep / <trip> / Memories, keeping only the Drive reference', async () => {
    const ctx = await setup();
    const photo = await ctx.journal.addPhoto(ctx.entry.id, 'file:///j1.jpg');
    await ctx.select('journal', photo.id, 'file:///j1.jpg');
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');

    expect(await runUploads(ME, ctx.deps)).toEqual({ uploaded: 2, retrying: 0, failed: 0, paused: null });
    const files = [...ctx.drive.files.values()];
    const root = files.find((f) => f.name === 'Trip Prep');
    const trip = files.find((f) => f.name === 'Kerala' && f.parents.includes(root?.id as string));
    const memories = files.find((f) => f.name === 'Memories' && f.parents.includes(trip?.id as string));
    const photos = files.filter((f) => f.parents.includes(memories?.id as string));
    expect(photos.map((f) => f.appProperties.kind).sort()).toEqual(['memory-photo', 'photo']);

    const rows = await ctx.photoUploads.byUris(ME, ['file:///j1.jpg', 'file:///m1.jpg']);
    for (const row of rows.values()) {
      expect(row.status).toBe('uploaded');
      expect(ctx.drive.files.has(row.driveFileId as string)).toBe(true);
    }
    expect(await ctx.photoUploads.counts(ME)).toEqual({ pending: 0, failed: 0, uploaded: 2 });

    // The manual journal backup does not upload the same photo again.
    const backup = await backupTrip(ctx.trip, { client: ctx.drive.client, repo: ctx.journal, readPhoto: ctx.deps.readPhoto });
    expect(backup).toMatchObject({ photosUploaded: 0, photosSkipped: 1 });
  });

  it('Drive busy: retries with growing gaps, then waits for Retry after repeated failures (offline is covered below)', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    const upload = ctx.drive.client.upload;
    ctx.drive.client.upload = jest.fn(async () => {
      throw new DriveError('rate_limited');
    });

    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 0, retrying: 1 });
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ retrying: 0 }); // not due yet
    ctx.advance(1);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ retrying: 1 });
    ctx.advance(1);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ retrying: 0 }); // second gap is 2 minutes
    ctx.advance(1);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ retrying: 1 });

    // Drive available again: the queued photo goes up.
    ctx.drive.client.upload = upload;
    ctx.advance(10);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });

    // A photo that keeps failing stops retrying on its own and waits for the user.
    await ctx.select('memory', ctx.munnar.id, 'file:///m2.jpg');
    ctx.drive.client.upload = jest.fn(async () => {
      throw new DriveError('unknown');
    });
    for (let i = 0; i < MAX_AUTOMATIC_ATTEMPTS; i++) {
      await runUploads(ME, ctx.deps);
      ctx.advance(61);
    }
    expect(await ctx.photoUploads.counts(ME)).toEqual({ pending: 0, failed: 1, uploaded: 1 });
    ctx.drive.client.upload = upload;
    expect(await ctx.photoUploads.retryAll(ME)).toBe(1);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
  });

  it('pauses on an expired connection without failing anything, and resumes after reconnecting', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await ctx.select('memory', ctx.munnar.id, 'file:///m2.jpg');
    const upload = ctx.drive.client.upload;
    ctx.drive.client.upload = jest.fn(async () => {
      throw new DriveError('auth');
    });
    expect(await runUploads(ME, ctx.deps)).toEqual({ uploaded: 0, retrying: 0, failed: 0, paused: 'auth' });
    expect(await ctx.photoUploads.counts(ME)).toEqual({ pending: 2, failed: 0, uploaded: 0 });
    ctx.drive.client.upload = upload; // reconnected
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 2, paused: null });
  });

  it('pauses when the Drive API is off or Drive is full', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    for (const kind of ['not_enabled', 'storage_full'] as const) {
      ctx.drive.client.upload = jest.fn(async () => {
        throw new DriveError(kind);
      });
      expect((await runUploads(ME, ctx.deps)).paused).toBe(kind);
    }
    expect((await ctx.photoUploads.counts(ME)).pending).toBe(1);
  });

  it('never uploads one account’s photos to another account’s Drive', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///mine.jpg', ME);
    await ctx.select('memory', ctx.munnar.id, 'file:///theirs.jpg', OTHER);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
    expect((await ctx.photoUploads.counts(OTHER)).pending).toBe(1);
  });

  it('fails a photo whose device copy is gone, and recreates a trip folder deleted in Drive', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    ctx.onDevice.delete('file:///m1.jpg');
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ failed: 1 });

    await ctx.select('memory', ctx.munnar.id, 'file:///m2.jpg');
    await ctx.select('memory', ctx.munnar.id, 'file:///m3.jpg');
    await runUploads(ME, ctx.deps);
    const tripFolder = [...ctx.drive.files.values()].find((f) => f.name === 'Memories')?.id as string;
    // Uploading into a folder that no longer exists fails like Drive does.
    const upload = ctx.drive.client.upload;
    ctx.drive.files.delete(tripFolder);
    ctx.drive.client.upload = jest.fn(async (input) => {
      if (!ctx.drive.files.has(input.parentId)) throw new DriveError('not_found');
      return upload(input);
    });
    await ctx.select('memory', ctx.munnar.id, 'file:///m4.jpg');
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
    expect([...ctx.drive.files.values()].filter((f) => f.name === 'Memories')).toHaveLength(1);
  });

  it('removing a photo from Trip Prep forgets it but leaves the original in Drive', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await runUploads(ME, ctx.deps);
    const driveId = (await ctx.photoUploads.byUris(ME, ['file:///m1.jpg'])).get('file:///m1.jpg')?.driveFileId as string;
    await ctx.photoUploads.removeByUri('file:///m1.jpg');
    expect((await ctx.photoUploads.byUris(ME, ['file:///m1.jpg'])).size).toBe(0);
    expect(ctx.drive.files.has(driveId)).toBe(true);
  });

  it('shows photos from Drive after the device copy is freed, and says why when it cannot', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await ctx.select('memory', ctx.munnar.id, 'file:///m2.jpg');
    await runUploads(ME, { ...ctx.deps, readPhoto: async (uri) => (uri.endsWith('m2.jpg') ? Promise.reject(new Error('x')) : { bytes: new Uint8Array([7]), mimeType: 'image/jpeg' }) });

    const exists = (uri: string) => ctx.onDevice.has(uri);
    const freed = await freeDeviceCopies(ME, { uploads: ctx.photoUploads, exists, remove: (uri) => ctx.onDevice.delete(uri), removable: () => true });
    expect(freed).toBe(1); // only the photo that is safely in Drive
    expect(ctx.onDevice.has('file:///m2.jpg')).toBe(true);

    const savePhoto = jest.fn(async () => {
      ctx.onDevice.add('file:///cache/m1.jpg');
      return 'file:///cache/m1.jpg';
    });
    const display = { uploads: ctx.photoUploads, exists, savePhoto };
    expect(await resolvePhoto('file:///m1.jpg', { ...display, client: null })).toEqual({ uri: null, from: null, reason: 'offline' });
    expect(await resolvePhoto('file:///m1.jpg', { ...display, client: ctx.drive.client })).toEqual({ uri: 'file:///cache/m1.jpg', from: 'drive' });
    expect(await resolvePhoto('file:///m1.jpg', { ...display, client: null })).toEqual({ uri: 'file:///cache/m1.jpg', from: 'drive' }); // cached
    expect(savePhoto).toHaveBeenCalledTimes(1);
    expect(await resolvePhoto('file:///m2.jpg', { ...display, client: null })).toEqual({ uri: 'file:///m2.jpg', from: 'device' });
    expect(await resolvePhoto('file:///never.jpg', { ...display, client: null })).toEqual({ uri: null, from: null, reason: 'not_uploaded' });
  });

  it('finds photos picked before Drive was connected so they can be uploaded too', async () => {
    const ctx = await setup();
    const photo = await ctx.journal.addPhoto(ctx.entry.id, 'file:///old-j.jpg');
    await ctx.companion.saveMemory(ctx.munnar.id, { photos: ['file:///old-m.jpg', 'file:///queued.jpg'] });
    await ctx.select('memory', ctx.munnar.id, 'file:///queued.jpg');
    expect(await ctx.photoUploads.unqueued(ME)).toEqual([
      { tripId: ctx.trip.id, source: 'journal', sourceId: photo.id, localUri: 'file:///old-j.jpg' },
      { tripId: ctx.trip.id, source: 'memory', sourceId: ctx.munnar.id, localUri: 'file:///old-m.jpg' },
    ]);
    expect(await ctx.photoUploads.unqueued(OTHER)).toHaveLength(3);
  });

  it('shows photos restored from the cloud backup ("drive:" references) from the user’s Drive, once', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await runUploads(ME, ctx.deps);
    const driveId = (await ctx.photoUploads.byUris(ME, ['file:///m1.jpg'])).get('file:///m1.jpg')?.driveFileId as string;
    const cache = new Map<string, string>();
    const driveCache = { get: async (id: string) => cache.get(id) ?? null, set: async (id: string, uri: string) => void cache.set(id, uri) };
    const savePhoto = jest.fn(async () => {
      ctx.onDevice.add('file:///cache/restored.jpg');
      return 'file:///cache/restored.jpg';
    });
    const deps = { uploads: ctx.photoUploads, exists: (u: string) => ctx.onDevice.has(u), savePhoto, driveCache };
    expect(await resolvePhoto(`drive:${driveId}`, { ...deps, client: null })).toEqual({ uri: null, from: null, reason: 'offline' });
    expect(await resolvePhoto(`drive:${driveId}`, { ...deps, client: ctx.drive.client })).toEqual({ uri: 'file:///cache/restored.jpg', from: 'drive' });
    expect(await resolvePhoto(`drive:${driveId}`, { ...deps, client: null })).toEqual({ uri: 'file:///cache/restored.jpg', from: 'drive' });
    expect(savePhoto).toHaveBeenCalledTimes(1);
    // A restored reference is never queued for upload again.
    await ctx.companion.saveMemory(ctx.munnar.id, { photos: [`drive:${driveId}`] });
    expect((await ctx.photoUploads.unqueued(ME)).some((u) => u.localUri.startsWith('drive:'))).toBe(false);
  });

  it('remembers the automatic-upload setting (on by default)', async () => {
    const ctx = await setup();
    expect(await ctx.photoUploads.autoUpload()).toBe(true);
    await ctx.photoUploads.setAutoUpload(false);
    expect(await ctx.photoUploads.autoUpload()).toBe(false);
  });
});

describe('Drive folders: Trip Prep / <trip> / Memories', () => {
  const folders = (ctx: Awaited<ReturnType<typeof setup>>) => [...ctx.drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');

  it('creates the root, trip and Memories folders once each, however many photos and runs', async () => {
    const ctx = await setup();
    for (let i = 0; i < 5; i++) await ctx.select('memory', ctx.munnar.id, `file:///m${i}.jpg`);
    await runUploads(ME, ctx.deps);
    await ctx.select('memory', ctx.munnar.id, 'file:///m9.jpg');
    await runUploads(ME, ctx.deps);
    expect(folders(ctx).map((f) => f.name).sort()).toEqual(['Kerala', 'Memories', 'Trip Prep']);
    expect(ctx.drive.calls.folders).toBe(3);
    expect(ctx.drive.calls.uploads).toBe(6);
    // Folder ids are remembered on this device (in this account's own database).
    const memories = folders(ctx).find((f) => f.name === 'Memories')!;
    expect((await ctx.journal.driveRecord('folder', `${ctx.trip.id}:memories`))?.driveFileId).toBe(memories.id);
  });

  it('a second trip gets its own folders under the same root', async () => {
    const ctx = await setup();
    const goa = await ctx.trips.create(tripInput({ name: 'Goa', destinations: [], startDate: '2027-01-02', endDate: '2027-01-05' }), { sections: [] });
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    ctx.onDevice.add('file:///g1.jpg');
    await ctx.photoUploads.enqueue({ accountId: ME, tripId: goa.id, source: 'memory', sourceId: 'x', localUri: 'file:///g1.jpg', fileName: 'g1.jpg' });
    await runUploads(ME, ctx.deps);
    expect(folders(ctx).map((f) => f.name).sort()).toEqual(['Goa', 'Kerala', 'Memories', 'Memories', 'Trip Prep']);
  });

  it('after a reconnect or reinstall (no remembered ids), finds the same folders by their tags, not by name', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await runUploads(ME, ctx.deps);
    await ctx.journal.forgetDriveRecord('folder', `${ctx.trip.id}:memories`);
    await ctx.journal.forgetDriveRecord('folder', ctx.trip.id);
    await ctx.journal.forgetDriveRecord('folder', 'root');
    // A user folder that merely has the same name is never used.
    await ctx.drive.client.createFolder('Memories', null, { kind: 'something-else' });
    await ctx.select('memory', ctx.munnar.id, 'file:///m2.jpg');
    await runUploads(ME, ctx.deps);
    const tagged = folders(ctx).filter((f) => f.appProperties.kind === 'memories');
    expect(tagged).toHaveLength(1);
    expect([...ctx.drive.files.values()].filter((f) => f.parents.includes(tagged[0]!.id))).toHaveLength(2);
  });

  it('an upload interrupted after Drive saved it is not uploaded twice', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    // Drive stores the file, then the app dies before recording the id.
    const markUploaded = ctx.photoUploads.markUploaded;
    ctx.photoUploads.markUploaded = jest.fn(async () => {
      throw new Error('app killed');
    });
    await runUploads(ME, ctx.deps).catch(() => undefined);
    ctx.photoUploads.markUploaded = markUploaded;
    expect(ctx.drive.calls.uploads).toBe(1);
    ctx.advance(120);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
    expect(ctx.drive.calls.uploads).toBe(1); // found by its tag, reused
    const row = (await ctx.photoUploads.byUris(ME, ['file:///m1.jpg'])).get('file:///m1.jpg');
    expect(row?.status).toBe('uploaded');
  });

  it('reuses a trip folder made by an earlier version as it is, and leaves photos already there untouched', async () => {
    const ctx = await setup();
    const root = await ctx.drive.client.createFolder('Trip Prep', null, { kind: 'root' });
    const old = await ctx.drive.client.createFolder('Kerala (2026-12-20)', root, { kind: 'trip', tripId: ctx.trip.id, tripName: 'Kerala' });
    const oldPhoto = await ctx.drive.client.upload({ name: 'memory-old.jpg', mimeType: 'image/jpeg', parentId: old, properties: { kind: 'memory-photo', localId: 'old' }, body: new Uint8Array([1]) });
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    await runUploads(ME, ctx.deps);
    expect(ctx.drive.files.get(old)?.name).toBe('Kerala (2026-12-20)');
    expect(ctx.drive.files.get(oldPhoto)?.parents).toEqual([old]);
    const memories = folders(ctx).find((f) => f.name === 'Memories');
    expect(memories?.parents).toEqual([old]);
    expect(folders(ctx).filter((f) => f.appProperties.kind === 'trip')).toHaveLength(1);
  });
});

describe('upload queue states', () => {
  const row = async (ctx: Awaited<ReturnType<typeof setup>>, uri: string, account = ME) => (await ctx.photoUploads.byUris(account, [uri])).get(uri)!;

  it('offline: waits for internet without using up automatic tries, then resumes', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    const upload = ctx.drive.client.upload;
    ctx.drive.client.upload = jest.fn(async () => {
      throw new DriveError('network');
    });
    for (let i = 0; i < MAX_AUTOMATIC_ATTEMPTS + 2; i++) expect(await runUploads(ME, ctx.deps)).toMatchObject({ paused: 'offline', failed: 0 });
    const waiting = await row(ctx, 'file:///m1.jpg');
    expect(waiting).toMatchObject({ status: 'pending', attempts: 0 });
    expect(uploadDisplayState(waiting, { driveConnected: true, paused: 'offline', uploadingId: null, now: ctx.now() })).toBe('waiting_internet');
    // Back online: the same queue row uploads (nothing re-picked, nothing duplicated).
    ctx.drive.client.upload = upload;
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1, paused: null });
    expect((await row(ctx, 'file:///m1.jpg')).status).toBe('uploaded');
  });

  it('expired token or revoked access: pauses as "reconnect", marks nothing failed, resumes after reconnecting', async () => {
    for (const kind of ['auth', 'denied'] as const) {
      const ctx = await setup();
      await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
      const upload = ctx.drive.client.upload;
      ctx.drive.client.upload = jest.fn(async () => {
        throw new DriveError(kind);
      });
      expect(await runUploads(ME, ctx.deps)).toMatchObject({ paused: 'auth', failed: 0, uploaded: 0 });
      const r = await row(ctx, 'file:///m1.jpg');
      expect(r).toMatchObject({ status: 'pending', attempts: 0 });
      expect(uploadDisplayState(r, { driveConnected: true, paused: 'auth', uploadingId: null, now: ctx.now() })).toBe('needs_reconnect');
      ctx.drive.client.upload = upload;
      expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
    }
  });

  it('transient errors retry on a schedule, then wait for a manual Retry; the device copy is kept throughout', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///m1.jpg');
    const upload = ctx.drive.client.upload;
    ctx.drive.client.upload = jest.fn(async () => {
      throw new DriveError('rate_limited');
    });
    await runUploads(ME, ctx.deps);
    const scheduled = await row(ctx, 'file:///m1.jpg');
    expect(uploadDisplayState(scheduled, { driveConnected: true, paused: null, uploadingId: null, now: ctx.now() })).toBe('retry_scheduled');
    for (let i = 0; i < MAX_AUTOMATIC_ATTEMPTS + 2; i++) {
      ctx.advance(120);
      await runUploads(ME, ctx.deps);
    }
    const failed = await row(ctx, 'file:///m1.jpg');
    expect(failed.status).toBe('failed');
    expect(uploadDisplayState(failed, { driveConnected: true, paused: null, uploadingId: null, now: ctx.now() })).toBe('failed');
    expect(ctx.onDevice.has('file:///m1.jpg')).toBe(true);
    // Free up space never removes a photo that is not in Drive.
    const removed: string[] = [];
    await freeDeviceCopies(ME, { uploads: ctx.photoUploads, exists: () => true, remove: (u) => removed.push(u), removable: () => true });
    expect(removed).toEqual([]);
    ctx.drive.client.upload = upload;
    await ctx.photoUploads.retryAll(ME);
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
  });

  it('derives every state from the stored row and the current run', () => {
    const base = { id: 'u1', status: 'pending' as const, attempts: 0, nextAttemptAt: '2026-12-20T10:00:00Z' };
    const run = { driveConnected: true, paused: null, uploadingId: null, now: new Date('2026-12-20T10:00:00Z') };
    expect(uploadDisplayState(base, run)).toBe('queued');
    expect(uploadDisplayState(base, { ...run, uploadingId: 'u1' })).toBe('uploading');
    expect(uploadDisplayState(base, { ...run, driveConnected: false })).toBe('waiting_drive');
    expect(uploadDisplayState(base, { ...run, paused: 'storage_full' })).toBe('waiting_drive');
    expect(uploadDisplayState({ ...base, status: 'uploaded' }, { ...run, paused: 'offline' })).toBe('uploaded');
  });

  it('a queue never crosses accounts: B’s run never uploads A’s pending photos', async () => {
    const ctx = await setup();
    await ctx.select('memory', ctx.munnar.id, 'file:///a.jpg', ME);
    expect(await runUploads(OTHER, ctx.deps)).toMatchObject({ uploaded: 0 });
    expect(ctx.drive.calls.uploads).toBe(0);
    expect((await row(ctx, 'file:///a.jpg')).status).toBe('pending');
    expect(await runUploads(ME, ctx.deps)).toMatchObject({ uploaded: 1 });
  });
});
