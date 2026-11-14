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
export const THUMB_WIDTH = 330;
/** How close a nearby page or photo must be when its title doesn't name the place. */
export const NEAR_KM = 3;

export interface CoverCandidate {
  pageTitle: string;
  imageFile: string;
  pageLocation: GeoPoint | null;
  description: string;
}

export interface CoverImage {
  imageUrl: string;
  /** A small variant (THUMB_WIDTH px) for cards and lists; never the original file. */
  thumbUrl: string;
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

export function searchUrl(q: CoverQuery, strategy: 'context' | 'name' | 'title' = 'context'): string {
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
  params.set('redirects', '1');
  if (exact) params.set('titles', exact);
  else if (strategy === 'title') params.set('titles', q.name);
  else {
    params.set('generator', 'search');
    params.set('gsrsearch', strategy === 'name' ? q.name : [q.name, q.context].filter(Boolean).join(' '));
    params.set('gsrlimit', '8');
  }
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

/** Wikipedia articles around a point (with a free lead image). */
export function geoSearchUrl(location: GeoPoint): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${location.latitude.toFixed(5)}|${location.longitude.toFixed(5)}`,
    ggsradius: '10000',
    ggslimit: '15',
    prop: 'pageimages|coordinates|description',
    piprop: 'name',
    pilicense: 'free',
    pilimit: '15',
    colimit: '15',
  });
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

/** Photos on Wikimedia Commons taken around a point (every Commons file is freely licensed). */
export function commonsGeoUrl(location: GeoPoint): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'geosearch',
    ggsnamespace: '6',
    ggscoord: `${location.latitude.toFixed(5)}|${location.longitude.toFixed(5)}`,
    ggsradius: '2000',
    ggslimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: String(COVER_WIDTH),
  });
  return `${COMMONS_API}?${params.toString()}`;
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
export function pickCandidates(body: unknown, q: CoverQuery, skip: readonly string[] = [], mode: 'named' | 'nearby' = 'named'): CoverCandidate[] {
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
      const title = norm((p.title as string).replace(/\s*\([^)]*\)\s*/g, ' '));
      const named = title.includes(name) || name.includes(title) || (words.length > 0 && words.every((w) => title.includes(w)));
      if (mode === 'nearby') {
        // Pages found around the coordinates: close by, and named like the place unless very close.
        if (!q.location || !location) return false;
        const d = km(q.location, location);
        return d <= NEAR_KM || (d <= 15 && (named || words.some((w) => title.split(' ').includes(w))));
      }
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

/** Only https images on Wikimedia's upload server in a format the app can show (no SVG maps, PDFs or TIFF originals). */
export function isUsableImageUrl(url: string): boolean {
  return /^https:\/\/upload\.wikimedia\.org\/.+\.(?:jpe?g|png|webp|gif)$/i.test(url);
}

/** The same Commons thumbnail at another width ("…/1280px-X.jpg" → "…/330px-X.jpg"); the original URL when it isn't a thumbnail. */
export function thumbVariant(url: string, width: number): string {
  return /\/thumb\/.+\/\d+px-[^/]+$/.test(url) ? url.replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`) : url;
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
  if (!url || !isUsableImageUrl(url) || !license || /non-?free|fair use/i.test(license) || meta.NonFree?.value === 'true') return null;
  const artist = stripHtml(meta.Artist?.value ?? meta.Credit?.value ?? '');
  return {
    imageUrl: url,
    thumbUrl: thumbVariant(url, THUMB_WIDTH),
    title: pageTitle,
    credit: artist || 'Wikimedia Commons contributor',
    license,
    sourceUrl: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page?.title ?? '')}`,
  };
}

const PHOTO_FILE = /\.(?:jpe?g|png|webp)$/i;
const NOT_A_PHOTO = /\b(?:map|locator|logo|flag|seal|emblem|coat of arms|diagram|plan|sign|icon)\b/i;

/** Alternative spellings of a place name to try: as typed, without brackets, before a comma. */
export function nameVariants(name: string): string[] {
  const out = [name.trim(), name.replace(/\s*\([^)]*\)/g, '').trim(), name.split(',')[0]?.trim() ?? ''];
  return [...new Set(out.filter((n) => n.length > 1))];
}

/**
 * Finds a cover, trying in order: the exact Wikipedia article (OSM tag), the
 * article titled like the place, a search with region context, a search by
 * name alone, articles around the coordinates, and finally photos taken
 * around the coordinates on Commons. The first freely licensed, valid image wins.
 */
export async function findCover(q: CoverQuery, deps: { fetchImpl: typeof fetch; skip?: readonly string[] }): Promise<(CoverImage & { imageFile: string }) | null> {
  const json = async (url: string) => {
    const r = await deps.fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Image search failed (${r.status}).`);
    return r.json();
  };
  const skip = deps.skip ?? [];
  const tried = new Set<string>();
  const firstFree = async (candidates: CoverCandidate[]) => {
    for (const c of candidates.filter((c) => !tried.has(c.imageFile)).slice(0, 3)) {
      tried.add(c.imageFile);
      const image = parseImageInfo(await json(imageInfoUrl(c.imageFile)), c.pageTitle);
      if (image) return { ...image, imageFile: c.imageFile };
    }
    return null;
  };

  if (q.wikipedia) {
    const found = await firstFree(pickCandidates(await json(searchUrl(q)), q, skip));
    if (found) return found;
  }
  const plain = { ...q, wikipedia: null };
  for (const name of nameVariants(q.name)) {
    const variant = { ...plain, name };
    for (const strategy of ['title', 'context', 'name'] as const) {
      if (strategy === 'name' && !variant.context) continue;
      const found = await firstFree(pickCandidates(await json(searchUrl(variant, strategy)), variant, skip));
      if (found) return found;
    }
  }
  if (!q.location) return null;
  const nearby = await firstFree(pickCandidates(await json(geoSearchUrl(q.location)), plain, skip, 'nearby'));
  if (nearby) return nearby;
  return pickCommonsPhoto(await json(commonsGeoUrl(q.location)), q, skip);
}

/** The best photo from a Commons geosearch: a real photo (not a map or logo), landscape-ish, freely licensed. */
export function pickCommonsPhoto(body: unknown, q: CoverQuery, skip: readonly string[] = []): (CoverImage & { imageFile: string }) | null {
  const pages = ((body as { query?: { pages?: unknown[] } })?.query?.pages ?? []) as { title?: string; index?: number; imageinfo?: { width?: number; height?: number; mime?: string }[] }[];
  const name = norm(q.name);
  const ranked = pages
    .filter((p) => p.title && PHOTO_FILE.test(p.title) && !NOT_A_PHOTO.test(p.title))
    .filter((p) => !skip.includes((p.title as string).replace(/^File:/, '')))
    .filter((p) => {
      const i = p.imageinfo?.[0];
      return !i?.width || !i.height || (i.width >= 640 && i.width / i.height >= 0.9);
    })
    .sort((a, b) => Number(norm(b.title as string).includes(name)) - Number(norm(a.title as string).includes(name)) || (a.index ?? 0) - (b.index ?? 0));
  for (const p of ranked) {
    const image = parseImageInfo({ query: { pages: [p] } }, q.name);
    if (image) return { ...image, imageFile: (p.title as string).replace(/^File:/, '') };
  }
  return null;
}
