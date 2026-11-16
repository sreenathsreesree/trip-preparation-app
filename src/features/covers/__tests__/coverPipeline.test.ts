import { setupRepositories } from '../../../../test/fixtures';
import { CoverLookupError } from '../coverErrors';
import { createCoverRepository } from '../coverRepository';
import { ensureAutoCover, MAX_CANDIDATES } from '../coverService';
import { findCover, isUsableImageUrl, nameVariants, thumbVariant, WIKIPEDIA_API } from '../wikimedia';
import { APP_USER_AGENT, imageSource, wikimediaFetch, wikimediaHeaders } from '../wikimediaClient';

// Real shapes observed from the live APIs on 2026-11-16 for Munnar.
const MUNNAR_PAGE = { query: { pages: [{ pageid: 300627, title: 'Munnar', pageimage: 'Munnar_Overview.jpg', coordinates: [{ lat: 10.08916667, lon: 77.05972222 }], description: 'Town in Kerala, India' }] } };
const THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Munnar_Overview.jpg/1280px-Munnar_Overview.jpg';
const info = (file: string, url = THUMB.replace('Munnar_Overview.jpg', file).replace('Munnar_Overview.jpg', file)) => ({
  query: { pages: [{ title: `File:${file}`, imageinfo: [{ thumburl: url, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="u">Jane Photographer</a>' } } }] }] },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Wikimedia as it behaves today: no identifying User-Agent → 403 (T400119). */
function wikimedia(opts: { pages?: unknown; files?: Record<string, unknown>; status?: number } = {}) {
  const calls: { url: string; ua: string | undefined }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ua = (init?.headers as Record<string, string> | undefined)?.['User-Agent'];
    calls.push({ url, ua });
    if (!ua || /okhttp/i.test(ua)) return new Response('Please set a user-agent and respect our robot policy', { status: 403 });
    if (opts.status) return new Response('busy', { status: opts.status });
    if (url.startsWith(WIKIPEDIA_API)) {
      const title = new URL(url).searchParams.get('titles');
      return json(title === 'Munnar' || title === null ? (opts.pages ?? MUNNAR_PAGE) : { query: { pages: [] } });
    }
    const file = decodeURIComponent(new URL(url).searchParams.get('titles') ?? '').replace('File:', '');
    return json(opts.files?.[file] ?? info(file));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('Wikimedia requests identify the app (Android root cause)', () => {
  it('sends a descriptive User-Agent on Android and in image sources', () => {
    expect(APP_USER_AGENT).toMatch(/^TripPrep\/.+github\.com/);
    expect(wikimediaHeaders({ Accept: 'application/json' })).toMatchObject({ 'User-Agent': APP_USER_AGENT, 'Api-User-Agent': APP_USER_AGENT, Accept: 'application/json' });
    expect(imageSource(THUMB)).toEqual({ uri: THUMB, headers: { 'User-Agent': APP_USER_AGENT } });
    expect(imageSource('file:///cover.jpg')).toEqual({ uri: 'file:///cover.jpg' });
  });

  it('finds Munnar’s cover through the identified client (a bare request is refused)', async () => {
    const wm = wikimedia();
    const bare = await findCover({ name: 'Munnar', context: 'Kerala, India', location: null }, { fetchImpl: wikimediaFetch(async () => new Response('no', { status: 403 })) }).catch((e: unknown) => e);
    expect(bare).toBeInstanceOf(CoverLookupError);
    const cover = await findCover({ name: 'Munnar', context: 'Kerala, India', location: null }, { fetchImpl: wikimediaFetch(wm.fetchImpl) });
    expect(cover).toMatchObject({ title: 'Munnar', imageFile: 'Munnar_Overview.jpg', license: 'CC BY-SA 4.0', credit: 'Jane Photographer' });
    expect(cover?.thumbUrl).toMatch(/\/330px-Munnar_Overview\.jpg$/);
    expect(wm.calls.every((c) => c.ua === APP_USER_AGENT)).toBe(true);
  });

  it('treats refusals and rate limits as temporary, not as “no photo”', async () => {
    for (const status of [403, 429, 503]) {
      const wm = wikimedia({ status });
      await expect(findCover({ name: 'Munnar', context: '', location: null }, { fetchImpl: wikimediaFetch(wm.fetchImpl) })).rejects.toBeInstanceOf(CoverLookupError);
    }
  });
});

describe('matching', () => {
  it('tries alternate names and the place’s town', () => {
    expect(nameVariants('Alleppey')).toContain('Alappuzha');
    expect(nameVariants('Cochin')).toContain('Kochi');
    expect(nameVariants('Echo Point', 'Munnar, Kerala, India')).toContain('Echo Point, Munnar');
  });
  it('accepts only real image URLs on Wikimedia’s upload server', () => {
    expect(isUsableImageUrl(THUMB)).toBe(true);
    for (const bad of ['http://upload.wikimedia.org/x.jpg', 'https://evil.example/x.jpg', 'https://upload.wikimedia.org/x.svg', 'https://upload.wikimedia.org/x.pdf', '']) expect(isUsableImageUrl(bad)).toBe(false);
    expect(thumbVariant(THUMB, 330)).toMatch(/\/330px-Munnar_Overview\.jpg$/);
  });
});

describe('saving, validating, caching and retrying covers', () => {
  async function setup(download: (url: string) => Promise<string | null>) {
    const repos = await setupRepositories();
    const repo = createCoverRepository(repos.database);
    const files = new Set<string>();
    const dl = jest.fn(async (url: string) => {
      const uri = await download(url);
      if (uri) files.add(uri);
      return uri;
    });
    return { repo, dl, files, exists: (u: string) => files.has(u) };
  }
  const q = { name: 'Munnar', context: 'Kerala, India', location: null };
  const subject = { type: 'node' as const, id: 'n1' };

  it('saves a validated cover with credit and an offline thumbnail, then never asks the network again', async () => {
    const wm = wikimedia();
    const { repo, dl, exists } = await setup(async (url) => `file:///${url.split('/').pop()}`);
    const cover = await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists });
    expect(cover).toMatchObject({ status: 'found', credit: 'Jane Photographer', license: 'CC BY-SA 4.0', thumbLocalUri: 'file:///330px-Munnar_Overview.jpg', localUri: 'file:///1280px-Munnar_Overview.jpg' });
    expect((await repo.get('node', 'n1'))?.thumbLocalUri).toBe('file:///330px-Munnar_Overview.jpg');
    const before = wm.calls.length;
    await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists });
    expect(wm.calls.length).toBe(before);
  });

  it('skips a candidate whose image does not download, and never saves a broken cover', async () => {
    const wm = wikimedia();
    const { repo, dl, exists } = await setup(async () => null);
    await expect(ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists })).rejects.toBeInstanceOf(CoverLookupError);
    expect(await repo.get('node', 'n1')).toBeNull();
    expect(dl).toHaveBeenCalled();
    void MAX_CANDIDATES;
  });

  it('does not store a temporary failure as “no photo”, and a retry succeeds', async () => {
    const { repo, dl, exists } = await setup(async (url) => `file:///${url.split('/').pop()}`);
    await expect(ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wikimedia({ status: 429 }).fetchImpl), download: dl, exists })).rejects.toBeInstanceOf(CoverLookupError);
    expect(await repo.get('node', 'n1')).toBeNull();
    const cover = await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wikimedia().fetchImpl), download: dl, exists }, { again: true });
    expect(cover.status).toBe('found');
  });

  it('“Search again” bypasses the one-week wait after nothing was found', async () => {
    const empty = wikimedia({ pages: { query: { pages: [] } } });
    const { repo, dl, exists } = await setup(async (url) => `file:///${url.split('/').pop()}`);
    expect((await ensureAutoCover(subject, { ...q, name: 'Nowhere Hamlet' }, { repo, fetchImpl: wikimediaFetch(empty.fetchImpl), download: dl, exists })).status).toBe('none');
    const calls = empty.calls.length;
    await ensureAutoCover(subject, { ...q, name: 'Nowhere Hamlet' }, { repo, fetchImpl: wikimediaFetch(empty.fetchImpl), download: dl, exists });
    expect(empty.calls.length).toBe(calls);
    await ensureAutoCover(subject, { ...q, name: 'Nowhere Hamlet' }, { repo, fetchImpl: wikimediaFetch(empty.fetchImpl), download: dl, exists }, { again: true });
    expect(empty.calls.length).toBeGreaterThan(calls);
  });

  it('re-downloads missing device copies and keeps the cover when offline', async () => {
    const wm = wikimedia();
    let online = true;
    const { repo, dl, files, exists } = await setup(async (url) => {
      if (!online) throw new CoverLookupError('offline', null);
      return `file:///${url.split('/').pop()}`;
    });
    await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists });
    files.clear();
    online = false;
    const kept = await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists });
    expect(kept.status).toBe('found');
    online = true;
    await ensureAutoCover(subject, q, { repo, fetchImpl: wikimediaFetch(wm.fetchImpl), download: dl, exists });
    expect(files.has('file:///330px-Munnar_Overview.jpg')).toBe(true);
  });
});
