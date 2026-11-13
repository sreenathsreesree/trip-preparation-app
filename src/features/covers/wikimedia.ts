import type { GeoPoint } from '../planner/model';

/**
 * Representative images from Wikipedia / Wikimedia Commons: free, keyless, no
 * billing, and every image carries its licence and author, which are shown
 * with it. Only freely licensed images are used (`pilicense=free`); a page
 * must be about this place (exact OSM Wikipedia link, or a search result near
 * the destination's coordinates when known); disambiguation pages are
 * skipped. When nothing fits, there is no cover — never an unrelated image.
 */
export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const COVER_WIDTH = 1280;
export const MAX_MATCH_KM = 60;

export interface CoverCandidate {
  pageTitle: string;
  imageFile: string;
  pageLocation: GeoPoint | null;
  description: string;
}

export interface CoverImage {
  imageUrl: string;
  title: string;
  credit: string;
  license: string;
  sourceUrl: string;
}

export interface CoverQuery {
  name: string;
  /** Region / state / country to disambiguate (e.g. "Kerala, India"). */
  context: string;
  location: GeoPoint | null;
  /** OSM `wikipedia` tag ("en:Munnar") when known: the exact article. */
  wikipedia?: string | null;
}

export function searchUrl(q: CoverQuery): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'pageimages|coordinates|description',
    piprop: 'name',
    pilicense: 'free',
    pilimit: '10',
    colimit: '10',
  });
  const exact = q.wikipedia?.startsWith('en:') ? q.wikipedia.slice(3) : null;
  if (exact) params.set('titles', exact);
  else {
    params.set('generator', 'search');
    params.set('gsrsearch', [q.name, q.context].filter(Boolean).join(' '));
    params.set('gsrlimit', '8');
  }
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

const km = (a: GeoPoint, b: GeoPoint) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Candidate pages with a free image, best first: exact title match, then
 * search order. Pages far from known coordinates or about a different name
 * are dropped (a search for "Echo Point, Kerala" must not give Echo Point in
 * Australia). Already-rejected images (`skip`) are left out.
 */
export function pickCandidates(body: unknown, q: CoverQuery, skip: readonly string[] = []): CoverCandidate[] {
  const pages = ((body as { query?: { pages?: unknown[] } })?.query?.pages ?? []) as {
    title?: string;
    pageimage?: string;
    index?: number;
    description?: string;
    coordinates?: { lat: number; lon: number }[];
  }[];
  const name = norm(q.name);
  const words = name.split(' ').filter((w) => w.length > 2);
  return pages
    .filter((p) => p.title && p.pageimage && !skip.includes(p.pageimage))
    .filter((p) => !/disambiguation|topics referred to by the same term/i.test(p.description ?? ''))
    .map((p) => ({
      p,
      location: p.coordinates?.[0] ? { latitude: p.coordinates[0].lat, longitude: p.coordinates[0].lon } : null,
    }))
    .filter(({ p, location }) => {
      if (q.wikipedia) return true;
      const title = norm(p.title as string);
      const named = title.includes(name) || words.every((w) => title.includes(w));
      if (!named) return false;
      if (q.location && location) return km(q.location, location) <= MAX_MATCH_KM;
      return true;
    })
    .sort((a, b) => Number(norm(b.p.title as string) === name) - Number(norm(a.p.title as string) === name) || (a.p.index ?? 0) - (b.p.index ?? 0))
    .map(({ p, location }) => ({ pageTitle: p.title as string, imageFile: p.pageimage as string, pageLocation: location, description: p.description ?? '' }));
}

export function imageInfoUrl(file: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(COVER_WIDTH),
  });
  return `${COMMONS_API}?${params.toString()}`;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** Image URL, licence and author from Commons; null without a free licence. */
export function parseImageInfo(body: unknown, pageTitle: string): CoverImage | null {
  const page = ((body as { query?: { pages?: unknown[] } })?.query?.pages ?? [])[0] as {
    title?: string;
    imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[];
  };
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value ?? '');
  const url = info?.thumburl ?? info?.url;
  if (!url || !license || /non-?free|fair use/i.test(license) || meta.NonFree?.value === 'true') return null;
  const artist = stripHtml(meta.Artist?.value ?? meta.Credit?.value ?? '');
  return {
    imageUrl: url,
    title: pageTitle,
    credit: artist || 'Wikimedia Commons contributor',
    license,
    sourceUrl: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page?.title ?? '')}`,
  };
}

/** Finds a cover: candidates from Wikipedia, licence from Commons, first one that is freely licensed. */
export async function findCover(q: CoverQuery, deps: { fetchImpl: typeof fetch; skip?: readonly string[] }): Promise<(CoverImage & { imageFile: string }) | null> {
  const json = async (url: string) => {
    const r = await deps.fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Image search failed (${r.status}).`);
    return r.json();
  };
  const candidates = pickCandidates(await json(searchUrl(q)), q, deps.skip);
  for (const c of candidates.slice(0, 4)) {
    const image = parseImageInfo(await json(imageInfoUrl(c.imageFile)), c.pageTitle);
    if (image) return { ...image, imageFile: c.imageFile };
  }
  return null;
}
