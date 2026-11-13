import { fakeDrive } from '../../../../test/fakeDrive';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { resolveThumbnail, THUMBNAIL_SIZE } from '../drive/photoUploader';
import { galleryColumns, galleryRows, groupGallery, type GalleryPhoto } from '../gallery';
import { createGalleryRepository } from '../galleryRepository';
import { clampOffset } from '../gallery/ZoomableImage';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-reanimated', () => ({}));

const photo = (key: string, tripId: string, date: string, tripStart = '2026-12-01'): GalleryPhoto => ({
  key,
  uri: `file:///${key}.jpg`,
  tripId,
  tripName: tripId,
  tripStart,
  date,
  source: 'journal',
  caption: '',
  place: null,
});

describe('gallery grouping', () => {
  const photos = [photo('a2', 'Kerala', '2026-12-21'), photo('g1', 'Goa', '2027-01-03', '2027-01-02'), photo('a1', 'Kerala', '2026-12-20'), photo('a3', 'Kerala', '2026-12-21')];

  it('groups by trip, newest trip first, photos in date order', () => {
    const sections = groupGallery(photos);
    expect(sections.map((s) => [s.title, s.subtitle, s.photos.map((p) => p.key)])).toEqual([
      ['Goa', '1 photo', ['g1']],
      ['Kerala', '3 photos', ['a1', 'a2', 'a3']],
    ]);
  });

  it('optionally splits by day', () => {
    expect(groupGallery(photos, { byDate: true }).map((s) => [s.title, s.subtitle, s.photos.length])).toEqual([
      ['Goa', '3 Jan 2027', 1],
      ['Kerala', '20 Dec 2026', 1],
      ['Kerala', '21 Dec 2026', 2],
    ]);
  });

  it('uses 2–3 columns on phones and more on tablets', () => {
    expect(galleryColumns(320)).toBe(2);
    expect(galleryColumns(360)).toBe(3);
    expect(galleryColumns(412)).toBe(3);
    expect(galleryColumns(1024)).toBe(5);
  });

  it('numbers grid cells in the same order the viewer swipes through', () => {
    const sections = groupGallery(photos);
    const rows = galleryRows(sections, 2);
    expect(rows.map((r) => (r.kind === 'header' ? `#${r.title}` : r.photos.map((p) => `${p.index}:${p.photo.key}`).join(',')))).toEqual(['#Goa', '0:g1', '#Kerala', '1:a1,2:a2', '3:a3']);
    expect(sections.flatMap((s) => s.photos).map((p) => p.key)).toEqual(['g1', 'a1', 'a2', 'a3']);
  });
});

describe('gallery query', () => {
  it('lists journal and Memories photos of every trip, or of one trip', async () => {
    const r = await setupRepositories();
    const kerala = await r.trips.create(tripInput({ name: 'Kerala', destinations: [], startDate: '2026-12-20', endDate: '2026-12-24' }), { sections: [] });
    const goa = await r.trips.create(tripInput({ name: 'Goa', destinations: [], startDate: '2027-01-02', endDate: '2027-01-05' }), { sections: [] });
    const entry = await r.journal.create(kerala.id, { entryDate: '2026-12-21', title: 'Day 2' });
    await r.journal.addPhoto(entry.id, 'file:///j1.jpg', 'Sunrise');
    const munnar = (await r.planner.addNode(kerala.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
    await r.companion.saveMemory(munnar.id, { photos: ['file:///m1.jpg', 'drive:abcdefghij12'], visitedOn: '2026-12-22' });
    const repo = createGalleryRepository(r.database);
    const all = await repo.list();
    expect(all.map((p) => [p.tripName, p.source, p.uri, p.date, p.place ?? p.caption]).sort()).toEqual([
      ['Kerala', 'journal', 'file:///j1.jpg', '2026-12-21', 'Sunrise'],
      ['Kerala', 'memory', 'drive:abcdefghij12', '2026-12-22', 'Munnar'],
      ['Kerala', 'memory', 'file:///m1.jpg', '2026-12-22', 'Munnar'],
    ]);
    expect(await repo.list(goa.id)).toEqual([]);
    expect(new Set(all.map((p) => p.key)).size).toBe(3);
  });
});

describe('thumbnails without downloading originals', () => {
  async function deps(onDevice: string[] = []) {
    const r = await setupRepositories();
    const drive = fakeDrive();
    const cache = new Map<string, string>();
    const saved: string[] = [];
    const exists = (u: string) => onDevice.includes(u) || saved.includes(u);
    return {
      r,
      drive,
      cache,
      d: {
        uploads: r.photoUploads,
        exists,
        savePhoto: async () => {
          const u = `file:///cache/${saved.length}.jpg`;
          saved.push(u);
          return u;
        },
        client: drive.client,
        driveCache: { get: async (k: string) => cache.get(k) ?? null, set: async (k: string, v: string) => void cache.set(k, v) },
      },
    };
  }

  it('device copy: shown directly, available offline, nothing fetched', async () => {
    const { d, drive } = await deps(['file:///p.jpg']);
    expect(await resolveThumbnail('file:///p.jpg', d)).toEqual({ uri: 'file:///p.jpg', offline: true, original: 'on_device' });
    expect(drive.calls).toMatchObject({ thumbnails: 0, downloads: 0 });
  });

  it('original only in Drive: fetches Drive’s small preview once, then reuses the cached one; the original is never downloaded', async () => {
    const { d, drive, cache } = await deps();
    const id = await drive.client.upload({ name: 'x.jpg', mimeType: 'image/jpeg', parentId: 'p', properties: {}, body: new Uint8Array([1]) });
    const first = await resolveThumbnail(`drive:${id}`, d);
    expect(first).toMatchObject({ offline: false, original: 'in_drive' });
    expect(cache.get(`thumb:${id}`)).toBe(first.uri);
    expect(await resolveThumbnail(`drive:${id}`, d)).toEqual(first);
    expect(drive.calls).toMatchObject({ thumbnails: 1, downloads: 0 });
    // Offline later: the cached preview still shows; the original is marked as not viewable offline.
    expect(await resolveThumbnail(`drive:${id}`, { ...d, client: null })).toEqual(first);
  });

  it('a cached original wins (viewable offline)', async () => {
    const { d, drive, cache } = await deps(['file:///cache/full.jpg']);
    cache.set('abc123456789', 'file:///cache/full.jpg');
    expect(await resolveThumbnail('drive:abc123456789', d)).toEqual({ uri: 'file:///cache/full.jpg', offline: true, original: 'on_device' });
    expect(drive.calls.thumbnails).toBe(0);
  });

  it('offline with nothing cached, deleted in Drive, or never uploaded: no image and the right reason', async () => {
    const { d } = await deps();
    expect(await resolveThumbnail('drive:gone12345678', { ...d, client: null })).toEqual({ uri: null, offline: false, original: 'in_drive' });
    expect(await resolveThumbnail('drive:gone12345678', d)).toEqual({ uri: null, offline: false, original: 'missing_in_drive' });
    expect(await resolveThumbnail('file:///lost.jpg', d)).toEqual({ uri: null, offline: false, original: 'not_uploaded' });
  });

  it('asks Drive for previews sized for the grid', () => {
    expect(THUMBNAIL_SIZE).toBeGreaterThanOrEqual(400);
  });
});

it('keeps a zoomed image from being dragged off screen', () => {
  expect(clampOffset(500, 1, 400)).toBe(0);
  expect(clampOffset(500, 2, 400)).toBe(200);
  expect(clampOffset(-500, 3, 400)).toBe(-400);
  expect(clampOffset(50, 2, 400)).toBe(50);
});

it('keeps photos of the same day in the order they were added', () => {
  const same = ['z', 'a', 'm'].map((k) => photo(k, 'Kerala', '2026-12-20'));
  expect(groupGallery(same)[0]!.photos.map((p) => p.key)).toEqual(['z', 'a', 'm']);
});
