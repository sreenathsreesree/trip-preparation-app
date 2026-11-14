import { setupRepositories } from '../../../../test/fixtures';
import { createCoverRepository } from '../coverRepository';
import { ensureAutoCover, NONE_RETRY_MS } from '../coverService';
import { COMMONS_API, findCover, parseImageInfo, pickCandidates, searchUrl, WIKIPEDIA_API } from '../wikimedia';

const MUNNAR = { latitude: 10.0889, longitude: 77.0595 };
const search = {
  query: {
    pages: [
      { title: 'Munnar (disambiguation)', pageimage: 'X.jpg', index: 1, description: 'Topics referred to by the same term' },
      { title: 'Echo Point', pageimage: 'Echo_Point_Australia.jpg', index: 2, coordinates: [{ lat: -33.73, lon: 150.31 }] },
      { title: 'Munnar', pageimage: 'Munnar_tea_hills.jpg', index: 3, coordinates: [{ lat: 10.09, lon: 77.06 }], description: 'Hill station in Kerala, India' },
      { title: 'Munnar Tea Museum', pageimage: 'Tea_museum.jpg', index: 4, coordinates: [{ lat: 10.1, lon: 77.07 }] },
      { title: 'Kerala', index: 5 },
    ],
  },
};
const info = (file: string, license = 'CC BY-SA 4.0') => ({
  query: { pages: [{ title: `File:${file}`, imageinfo: [{ thumburl: `https://upload.wikimedia.org/thumb/${file}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Jane Doe</a>' } } }] }] },
});

function fakeWiki(opts: { nonFree?: string[] } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url.startsWith(WIKIPEDIA_API)) return new Response(JSON.stringify(search));
    const file = decodeURIComponent(new URL(url).searchParams.get('titles') ?? '').replace('File:', '');
    return new Response(JSON.stringify(info(file, opts.nonFree?.includes(file) ? 'Non-free media' : 'CC BY-SA 4.0')));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('choosing a representative image (Wikipedia / Wikimedia Commons)', () => {
  it('searches with the place and its region, free images only', () => {
    const url = new URL(searchUrl({ name: 'Munnar', context: 'Kerala, India', location: MUNNAR }));
    expect(url.searchParams.get('gsrsearch')).toBe('Munnar Kerala, India');
    expect(url.searchParams.get('pilicense')).toBe('free');
    expect(new URL(searchUrl({ name: 'x', context: '', location: null, wikipedia: 'en:Lakkam Waterfalls' })).searchParams.get('titles')).toBe('Lakkam Waterfalls');
  });

  it('takes the page about this place: exact name first, near the destination, no disambiguation, no namesakes elsewhere', () => {
    expect(pickCandidates(search, { name: 'Munnar', context: 'Kerala', location: MUNNAR }).map((c) => c.pageTitle)).toEqual(['Munnar', 'Munnar Tea Museum']);
    expect(pickCandidates(search, { name: 'Echo Point', context: 'Kerala', location: MUNNAR })).toEqual([]);
    expect(pickCandidates(search, { name: 'Munnar', context: '', location: MUNNAR }, ['Munnar_tea_hills.jpg']).map((c) => c.pageTitle)).toEqual(['Munnar Tea Museum']);
  });

  it('keeps licence and author; refuses non-free images', () => {
    expect(parseImageInfo(info('A.jpg'), 'Munnar')).toEqual({ imageUrl: 'https://upload.wikimedia.org/thumb/A.jpg', thumbUrl: 'https://upload.wikimedia.org/thumb/A.jpg', title: 'Munnar', credit: 'Jane Doe', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' });
    expect(parseImageInfo(info('A.jpg', 'Non-free media'), 'Munnar')).toBeNull();
  });

  it('falls through to the next suitable image when one is not free; none when nothing fits', async () => {
    const wiki = fakeWiki({ nonFree: ['Munnar_tea_hills.jpg'] });
    expect((await findCover({ name: 'Munnar', context: '', location: MUNNAR }, { fetchImpl: wiki.fetchImpl }))?.title).toBe('Munnar Tea Museum');
    expect(wiki.calls.every((u) => u.startsWith(WIKIPEDIA_API) || u.startsWith(COMMONS_API))).toBe(true);
    expect(await findCover({ name: 'Nowhere Falls', context: '', location: null }, { fetchImpl: fakeWiki().fetchImpl })).toBeNull();
    // With coordinates, an article about a place within a few km stands in.
    expect((await findCover({ name: 'Nowhere Falls', context: '', location: MUNNAR }, { fetchImpl: fakeWiki().fetchImpl }))?.title).toBe('Munnar');
    expect(await findCover({ name: 'Nowhere Falls', context: '', location: { latitude: 30, longitude: 30 } }, { fetchImpl: fakeWiki().fetchImpl })).toBeNull();
  });
});

describe('automatic covers', () => {
  async function setup() {
    const r = await setupRepositories();
    const repo = createCoverRepository(r.database);
    const wiki = fakeWiki();
    const downloads: string[] = [];
    const deps = { repo, fetchImpl: wiki.fetchImpl, download: async (u: string) => (downloads.push(u), `file:///covers/${downloads.length}.jpg`), now: new Date('2026-11-20T00:00:00Z') };
    return { repo, wiki, downloads, deps };
  }
  const q = { name: 'Munnar', context: 'Kerala', location: MUNNAR };

  it('chooses, downloads once for offline use, and reuses it without searching again', async () => {
    const { deps, wiki, downloads } = await setup();
    const cover = await ensureAutoCover({ type: 'node', id: 'n1' }, q, deps);
    expect(cover).toMatchObject({ status: 'found', title: 'Munnar', localUri: 'file:///covers/1.jpg', credit: 'Jane Doe', license: 'CC BY-SA 4.0' });
    const calls = wiki.calls.length;
    expect(await ensureAutoCover({ type: 'node', id: 'n1' }, q, deps)).toEqual(cover);
    expect(wiki.calls).toHaveLength(calls);
    expect(downloads).toHaveLength(1);
  });

  it('"Change" moves to the next suitable image and remembers the skipped one', async () => {
    const { deps } = await setup();
    await ensureAutoCover({ type: 'node', id: 'n1' }, q, deps);
    const next = await ensureAutoCover({ type: 'node', id: 'n1' }, q, deps, { refresh: true });
    expect(next).toMatchObject({ title: 'Munnar Tea Museum', skipped: ['Munnar_tea_hills.jpg'] });
    // Nothing else suitable: the current image stays.
    expect((await ensureAutoCover({ type: 'node', id: 'n1' }, q, deps, { refresh: true })).title).toBe('Munnar Tea Museum');
  });

  it('no suitable image: placeholder state, retried only after a week', async () => {
    const { deps, wiki } = await setup();
    const none = await ensureAutoCover({ type: 'node', id: 'n2' }, { ...q, name: 'Nowhere Falls', location: null }, deps);
    expect(none).toMatchObject({ status: 'none', imageUrl: null });
    const calls = wiki.calls.length;
    await ensureAutoCover({ type: 'node', id: 'n2' }, { ...q, name: 'Nowhere Falls', location: null }, { ...deps, now: new Date(deps.now.getTime() + 1000) });
    expect(wiki.calls).toHaveLength(calls);
    await ensureAutoCover({ type: 'node', id: 'n2' }, { ...q, name: 'Nowhere Falls' }, { ...deps, now: new Date(deps.now.getTime() + NONE_RETRY_MS + 1) });
    expect(wiki.calls.length).toBeGreaterThan(calls);
  });

  it('never touches an own cover photo: those live in the destination profile, not here', async () => {
    const r = await setupRepositories();
    const repo = createCoverRepository(r.database);
    await ensureAutoCover({ type: 'node', id: 'n1' }, q, { repo, fetchImpl: fakeWiki().fetchImpl, download: async () => null });
    const cols = (await r.database.getAllAsync<{ name: string }>("PRAGMA table_info('auto_covers')", [])).map((c) => c.name);
    expect(cols).not.toContain('cover_image_uri');
  });
});
