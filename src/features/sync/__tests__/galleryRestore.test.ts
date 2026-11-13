import { fakeDrive } from '../../../../test/fakeDrive';
import { fakeSyncServer } from '../../../../test/fakeSyncServer';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { resolveThumbnail } from '../../journal/drive/photoUploader';
import { createGalleryRepository } from '../../journal/galleryRepository';
import { linkAccount, runSync } from '../syncEngine';

const ASHA = 'asha-0000-4000-8000-000000000001';

it('after a reinstall, Memories photos come back as Drive references, appear in the gallery and show Drive previews without downloading originals', async () => {
  const server = fakeSyncServer();
  const drive = fakeDrive();
  const phone = await setupRepositories(openTestDatabase(), '2026-11-15T08:00:00.000Z', 'p');
  const trip = await phone.trips.create(tripInput({ name: 'Kerala', destinations: [], startDate: '2026-12-20', endDate: '2026-12-24' }), { sections: [] });
  const munnar = (await phone.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  await phone.companion.saveMemory(munnar.id, { photos: ['file:///p/tea.jpg'], visitedOn: '2026-12-21' });
  const fileId = await drive.client.upload({ name: 'tea.jpg', mimeType: 'image/jpeg', parentId: 'memories', properties: {}, body: new Uint8Array([9, 9]) });
  const q = await phone.photoUploads.enqueue({ accountId: ASHA, tripId: trip.id, source: 'memory', sourceId: munnar.id, localUri: 'file:///p/tea.jpg', fileName: 'tea.jpg' });
  await phone.photoUploads.markUploaded(q.id, fileId);
  await linkAccount(phone.database, ASHA);
  await runSync(phone.database, server.apiFor(ASHA), { accountId: ASHA, createId: phone.deps.createId, now: phone.deps.now });

  const fresh = await setupRepositories(openTestDatabase(), '2026-11-16T08:00:00.000Z', 'f');
  await linkAccount(fresh.database, ASHA);
  await runSync(fresh.database, server.apiFor(ASHA), { accountId: ASHA, createId: fresh.deps.createId, now: fresh.deps.now });
  const photos = await createGalleryRepository(fresh.database).list();
  expect(photos.map((p) => [p.tripName, p.place, p.uri])).toEqual([['Kerala', 'Munnar', `drive:${fileId}`]]);

  const cache = new Map<string, string>();
  const thumb = await resolveThumbnail(photos[0]!.uri, {
    uploads: fresh.photoUploads,
    exists: (u) => u.startsWith('file:///cache/'),
    savePhoto: async () => 'file:///cache/t.jpg',
    client: drive.client,
    driveCache: { get: async (k) => cache.get(k) ?? null, set: async (k, v) => void cache.set(k, v) },
  });
  expect(thumb).toEqual({ uri: 'file:///cache/t.jpg', offline: false, original: 'in_drive' });
  expect(drive.calls.downloads).toBe(0);
  expect(drive.files.get(fileId)).toBeDefined(); // the Drive original is untouched
});
