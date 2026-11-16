import { distanceMeters } from '../planner/arrival';
import { isValidLocation, type GeoPoint } from '../planner/model';
import { normalizePlaceName } from './discovery';
import { OSM_ATTRIBUTION, placeFromPhoton } from './osm';
import { PHOTON_URL } from './osmProvider';
import { isFullCode, isValidCode, PLUS_CODE_RE, plusCodeLocation } from './plusCodes';
import type { PlaceDetails, PlacesProvider } from './provider';

/**
 * Reads a location from whatever the user pastes or shares into Trip Prep:
 * coordinates (decimal, with N/S/E/W, or degrees-minutes-seconds), full Google
 * Maps links (place, search, directions, `?q=`, `!3d…!4d…`, `@lat,lng`),
 * `geo:` URIs, short share links (maps.app.goo.gl — followed online, never
 * guessed), and the "Name\nAddress\nlink" text the Google Maps app shares.
 * Nothing is fabricated: when only a name is known, the caller searches for it
 * and the user picks; when nothing usable is found, the reason is reported.
 */
export interface ParsedShare {
  location: GeoPoint | null;
  /** A clean place name (never a whole address or a Plus Code). */
  name: string | null;
  /** What to search for when there are no coordinates: the clean name. */
  query: string | null;
  /** A short link that must be opened (followed) to read the place. */
  shortLink: string | null;
  /** The first link found, if any (kept with the place for reference). */
  url: string | null;
  /** A Google Place ID found in the link (e.g. `query_place_id=ChIJ…`). */
  placeId: string | null;
  /** A Plus Code from the shared text ("3335+9GH" or "7J2V3335+9GH"). */
  plusCode: string | null;
  /** The address that came with the name, if any. */
  address: string | null;
  /** The town or area named in the address (helps a name search). */
  locality: string | null;
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const URL_RE = /(?:https?:\/\/|geo:)[^\s<>"]+/i;
const SHORT_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i;

function point(lat: number, lng: number): GeoPoint | null {
  const p = { latitude: lat, longitude: lng };
  return isValidLocation(p) && !(lat === 0 && lng === 0) ? p : null;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
}

/** "10.0889, 77.0595", "10.0889 77.0595", "10.0889° N, 77.0595° E", "10°05'20\"N 77°03'34\"E". */
export function parseCoordinates(text: string): GeoPoint | null {
  const t = text.trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  const plain = new RegExp(String.raw`^\(?${NUM}\s*[,;\s]\s*${NUM}\)?$`).exec(t);
  if (plain) return point(Number(plain[1]), Number(plain[2]));

  const hemi = /^(\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])\s*[,;\s]\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])$/i.exec(t);
  if (hemi) {
    const lat = Number(hemi[1]) * (/s/i.test(hemi[2] ?? '') ? -1 : 1);
    const lng = Number(hemi[3]) * (/w/i.test(hemi[4] ?? '') ? -1 : 1);
    return point(lat, lng);
  }

  const part = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(?:(\d{1,2}(?:\.\d+)?)\s*"\s*)?([NSEW])`;
  const dms = new RegExp(String.raw`^${part}\s*[,;\s]?\s*${part}$`, 'i').exec(t);
  if (dms) {
    const val = (d: string | undefined, m: string | undefined, s: string | undefined, h: string | undefined) =>
      (Number(d) + Number(m) / 60 + Number(s ?? 0) / 3600) * (/[sw]/i.test(h ?? '') ? -1 : 1);
    const a = val(dms[1], dms[2], dms[3], dms[4]);
    const b = val(dms[5], dms[6], dms[7], dms[8]);
    const firstIsLat = /[ns]/i.test(dms[4] ?? '');
    return firstIsLat ? point(a, b) : point(b, a);
  }
  return null;
}

/** Coordinates and/or a name from a (long) Google Maps, geo: or OpenStreetMap link. */
export function parseMapsUrl(url: string): { location: GeoPoint | null; name: string | null; placeId: string | null } {
  let location: GeoPoint | null = null;
  let name: string | null = null;
  const tryPoint = (re: RegExp) => {
    if (location) return;
    const m = re.exec(url);
    if (m) location = point(Number(m[1]), Number(m[2]));
  };
  // Pinned place (most precise), then explicit query parameters, then the path, then the map view.
  tryPoint(new RegExp(String.raw`!3d${NUM}!4d${NUM}`));
  tryPoint(new RegExp(String.raw`[?&](?:q|query|destination|daddr|ll|center|sll|mlat)=(?:loc:)?${NUM}(?:,|%2C)\s*(?:\+|%20)?${NUM}`, 'i'));
  tryPoint(new RegExp(String.raw`^geo:${NUM},${NUM}`, 'i'));
  tryPoint(new RegExp(String.raw`/(?:search|place|dir(?:/[^/]*)*)/${NUM},(?:\+|%20)?${NUM}`, 'i'));
  tryPoint(new RegExp(String.raw`[?&]mlat=${NUM}&mlon=${NUM}`, 'i'));
  tryPoint(new RegExp(String.raw`#map=\d+/${NUM}/${NUM}`, 'i'));
  tryPoint(new RegExp(String.raw`@${NUM},${NUM}`));

  const placeName = /\/maps\/place\/([^/@?]+)/i.exec(url);
  if (placeName) name = decode(placeName[1] ?? '').trim();
  if (!name) {
    const q = /[?&](?:q|query)=([^&#]+)/i.exec(url);
    let value = q ? decode(q[1] ?? '').trim() : '';
    // "q=10.0889,77.0595(Kolukkumalai)": coordinates with the name in brackets.
    const labelled = /^[-\d.,\s]+\(([^)]+)\)$/.exec(value);
    if (labelled) value = (labelled[1] ?? '').trim();
    if (value && !parseCoordinates(value.replace(/^loc:/, ''))) name = value;
  }
  if (!name) {
    const geoQ = /^geo:[^?]*\?q=([^&#]+)/i.exec(url);
    if (geoQ) {
      const value = decode(geoQ[1] ?? '').replace(/^[-\d.,\s]+(?=\()/, '').replace(/^\((.*)\)$/, '$1').trim();
      const inParens = /\(([^)]+)\)/.exec(value);
      name = (inParens?.[1] ?? value).trim() || null;
    }
  }
  if (name && parseCoordinates(name)) name = null;
  // Google Maps URLs can carry the Place ID itself.
  const id =
    /[?&](?:query_place_id|destination_place_id|origin_place_id|place_id)=([A-Za-z0-9_-]{16,})/i.exec(url)?.[1] ??
    /(?:place_id(?::|%3A))(ChIJ[A-Za-z0-9_-]{10,})/i.exec(url)?.[1] ??
    /!1s(ChIJ[A-Za-z0-9_-]{10,})/.exec(url)?.[1] ??
    null;
  if (name && id && /^place_id:/i.test(name)) name = null;
  return { location, name: name || null, placeId: id };
}

const POSTCODE = /\b\d{5,6}\b/;

/**
 * Splits one shared line into a clean name and its address: Google Maps shares
 * lines like "3335+9GH Attukad Waterfalls, Attukad Waterfall Rd, Pallivasal,
 * Keralam 685612". The Plus Code and the street/state/postcode are kept apart so
 * a search uses only "Attukad Waterfalls".
 */
export function splitShareLine(line: string): { name: string | null; address: string | null; plusCode: string | null; locality: string | null } {
  let rest = line.replace(/\s+/g, ' ').trim();
  const code = PLUS_CODE_RE.exec(rest)?.[1] ?? null;
  const plusCode = code && isValidCode(code) ? code.toUpperCase() : null;
  if (plusCode && code) rest = rest.replace(code, ' ').replace(/^[\s,]+/, '').replace(/\s+/g, ' ').trim();
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  const addressLike = parts.length >= 3 || (parts.length === 2 && POSTCODE.test(parts[1] ?? '')) || Boolean(plusCode && parts.length >= 2);
  if (!addressLike) return { name: rest || null, address: null, plusCode, locality: null };
  const localityPart = parts.length >= 3 ? (parts[parts.length - 2] ?? '') : (parts[1] ?? '');
  const locality = localityPart.replace(POSTCODE, '').trim() || null;
  return { name: parts[0] ?? null, address: parts.join(', '), plusCode, locality };
}

/** Parses pasted or shared text. Pure; see `resolveShare` for the online steps. */
export function parseShare(input: string, subject?: string | null): ParsedShare {
  const text = input.trim();
  const out: ParsedShare = { location: null, name: null, query: null, shortLink: null, url: null, placeId: null, plusCode: null, address: null, locality: null };
  if (!text) return out;

  const direct = parseCoordinates(text);
  if (direct) return { ...out, location: direct };

  const rawUrl = URL_RE.exec(text)?.[0] ?? null;
  // Trailing punctuation is not part of a link, except a ")" that closes a "(" inside it.
  const url = rawUrl ? (rawUrl.includes('(') ? rawUrl.replace(/[.,]+$/, '') : rawUrl.replace(/[).,]+$/, '')) : null;
  out.url = url;
  let urlName: string | null = null;
  if (url) {
    if (SHORT_RE.test(url)) out.shortLink = url;
    else {
      const parsed = parseMapsUrl(url);
      out.location = parsed.location;
      out.placeId = parsed.placeId;
      urlName = parsed.name;
    }
  }
  // Text around the link: Google Maps shares "Name\nAddress\nlink", "Address link" or "Name, address link".
  const rest = (url ? text.replace(url, ' ') : text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:/i.test(l) && /[\p{L}\p{N}]/u.test(l));
  if (!out.location) {
    for (const line of rest) {
      const p = parseCoordinates(line);
      if (p) {
        out.location = p;
        break;
      }
    }
  }
  const textLines = rest.filter((l) => !parseCoordinates(l));
  const split = textLines.map(splitShareLine);
  const fromUrl = urlName ? splitShareLine(urlName) : null;
  // A line that is only a name (no address parts) is the best name; otherwise the first part of an address line.
  const plainName = split.find((p) => p.name && !p.address && !p.plusCode)?.name ?? null;
  const addressLine = split.find((p) => p.address || p.plusCode) ?? fromUrl ?? null;
  out.name = (plainName ?? fromUrl?.name ?? addressLine?.name ?? (subject?.trim() || null))?.slice(0, 120) ?? null;
  out.address = addressLine?.address ?? null;
  out.locality = addressLine?.locality ?? null;
  out.plusCode = split.find((p) => p.plusCode)?.plusCode ?? fromUrl?.plusCode ?? null;
  if (!out.location && out.plusCode && isFullCode(out.plusCode)) out.location = plusCodeLocation(out.plusCode);
  if (out.name && isValidCode(out.name)) out.name = out.locality;
  if (!out.location && out.name) out.query = out.name;
  else if (!out.location && !url && text) out.query = text.slice(0, 120);
  return out;
}

export type ResolvedShare =
  | { status: 'located'; place: PlaceDetails; candidates: PlaceDetails[] }
  | { status: 'choose'; candidates: PlaceDetails[]; query: string }
  | { status: 'unresolved'; reason: string; name?: string | null; url?: string | null };

export interface ResolveDeps {
  fetchImpl?: typeof fetch;
  provider: Pick<PlacesProvider, 'textSearch' | 'configured'> & Partial<Pick<PlacesProvider, 'id' | 'details' | 'nearby' | 'resolveLink'>>;
  signal?: AbortSignal;
}

/** Follows a short share link (no API, no key) and returns the final URL, or null when it can't be read. */
export async function followShortLink(url: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal, headers: { Accept: 'text/html' } });
    if (res.url && res.url !== url) return res.url;
    // Some responses end on an interstitial page: look for the canonical maps link in it.
    const html = typeof res.text === 'function' ? await res.text() : '';
    const m = /https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>]+/i.exec(html);
    return m ? m[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&') : null;
  } catch {
    return null;
  }
}

/** Name and address for coordinates, from OpenStreetMap (Photon reverse geocoding). */
export async function reverseGeocode(location: GeoPoint, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<PlaceDetails | null> {
  try {
    const params = new URLSearchParams({ lat: location.latitude.toFixed(6), lon: location.longitude.toFixed(6), limit: '1' });
    const res = await fetchImpl(`${PHOTON_URL.replace(/api\/$/, 'reverse')}?${params.toString()}`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { features?: Parameters<typeof placeFromPhoton>[0][] };
    const found = body.features?.[0] ? placeFromPhoton(body.features[0]) : null;
    return found;
  } catch {
    return null;
  }
}

/** A place at exact coordinates (named from the link, reverse geocoding, or the coordinates themselves). */
export function pinnedPlace(location: GeoPoint, name: string | null, nearby: PlaceDetails | null): PlaceDetails {
  const near = nearby?.location && distanceMeters(nearby.location, location) < 150 ? nearby : null;
  const label = name ?? near?.name ?? `Pinned location ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  return {
    provider: 'manual',
    providerPlaceId: near && (!name || name === near.name) ? near.providerPlaceId : `pin:${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`,
    name: label,
    location,
    formattedAddress: nearby?.formattedAddress ?? '',
    types: near?.types ?? [],
    district: nearby?.district ?? null,
    state: nearby?.state ?? null,
    country: nearby?.country ?? null,
    metadata: { source: 'shared-link' },
    rating: null,
    userRatingCount: null,
    editorialSummary: null,
    photos: [],
    mapsUri: null,
    attributions: nearby ? [OSM_ATTRIBUTION] : [],
  };
}

/** Keeps the original shared link with the place, for reference. */
const withLink = (place: PlaceDetails, url: string | null): PlaceDetails => (url ? { ...place, metadata: { ...place.metadata, sharedUrl: url } } : place);

const sameName = (a: string | null, b: string) => {
  if (!a) return false;
  const x = normalizePlaceName(a);
  const y = normalizePlaceName(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
};

/**
 * Turns pasted/shared text into a place to preview. In order:
 * 1. a short link is opened (on the device, else through the places service);
 * 2. a Place ID is looked up directly;
 * 3. coordinates (from the link, the text or a full Plus Code) are matched to the place at
 *    that spot, or kept as a pinned location;
 * 4. otherwise the clean name is searched (never the whole address or the Plus Code), and a
 *    short Plus Code is used to put the shared pin and the closest match first.
 * The user always confirms; nothing unrelated is chosen silently.
 */
export async function resolveShare(input: string, deps: ResolveDeps, subject?: string | null): Promise<ResolvedShare> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const provider = deps.provider;
  let parsed = parseShare(input, subject);
  const sharedUrl = parsed.url;
  const unresolved = (reason: string): ResolvedShare => ({ status: 'unresolved', reason, name: parsed.name, url: sharedUrl });

  if (parsed.shortLink) {
    let finalUrl = await followShortLink(parsed.shortLink, fetchImpl, deps.signal);
    if (!finalUrl && provider.configured && provider.resolveLink) finalUrl = await provider.resolveLink(parsed.shortLink, deps.signal).catch(() => null);
    if (finalUrl) {
      const fromUrl = parseMapsUrl(finalUrl);
      const urlName = fromUrl.name ? splitShareLine(fromUrl.name) : null;
      parsed = {
        ...parsed,
        location: parsed.location ?? fromUrl.location,
        placeId: parsed.placeId ?? fromUrl.placeId,
        name: parsed.name ?? urlName?.name ?? null,
        address: parsed.address ?? urlName?.address ?? null,
        locality: parsed.locality ?? urlName?.locality ?? null,
        plusCode: parsed.plusCode ?? urlName?.plusCode ?? null,
      };
      if (!parsed.location && parsed.plusCode && isFullCode(parsed.plusCode)) parsed.location = plusCodeLocation(parsed.plusCode);
      parsed.query = parsed.location ? null : parsed.name;
    }
  }

  // 2. Place ID → the exact place.
  if (parsed.placeId && provider.configured && provider.id === 'google' && provider.details) {
    try {
      const place = await provider.details(parsed.placeId, {}, deps.signal);
      return { status: 'located', place: withLink(place, sharedUrl), candidates: [] };
    } catch {
      // Fall through to coordinates or the name.
    }
  }

  // 3. Coordinates → the place at that spot, or a pinned location.
  if (parsed.location) {
    let match: PlaceDetails | null = null;
    if (provider.configured && provider.id === 'google' && provider.nearby) {
      try {
        const around = await provider.nearby({ location: parsed.location, radiusMeters: 150, maxResults: 10, rank: 'distance' }, deps.signal);
        const near = around.filter((p) => p.location && distanceMeters(p.location, parsed.location as GeoPoint) <= 150);
        match = near.find((p) => sameName(parsed.name, p.name)) ?? (parsed.name ? null : (near.find((p) => p.location && distanceMeters(p.location, parsed.location as GeoPoint) <= 40) ?? null));
      } catch {
        match = null;
      }
    }
    if (match) return { status: 'located', place: withLink({ ...match, location: match.location ?? parsed.location }, sharedUrl), candidates: [] };
    const nearby = await reverseGeocode(parsed.location, fetchImpl, deps.signal);
    const pinned = pinnedPlace(parsed.location, parsed.name, nearby);
    return { status: 'located', place: withLink({ ...pinned, formattedAddress: pinned.formattedAddress || parsed.address || '' }, sharedUrl), candidates: [] };
  }

  // 4. Clean name search.
  const query = parsed.name ?? parsed.query;
  if (query && provider.configured) {
    let candidates: PlaceDetails[] = [];
    let searchFailed = false;
    for (const q of [query, parsed.locality ? `${query} ${parsed.locality}` : null].filter((x): x is string => Boolean(x))) {
      try {
        candidates = await provider.textSearch({ query: q, maxResults: 6 }, deps.signal);
      } catch {
        searchFailed = true;
        continue;
      }
      if (candidates.length) break;
    }
    if (candidates.length) {
      // A short Plus Code becomes an exact pin once any nearby result gives a reference point.
      const reference = candidates.find((c) => c.location)?.location ?? null;
      const pin = parsed.plusCode && reference ? plusCodeLocation(parsed.plusCode, reference) : null;
      const pinTrusted = pin && reference && distanceMeters(pin, reference) <= 40_000 ? pin : null;
      if (pinTrusted) {
        const sorted = [...candidates].sort((a, b) => (a.location ? distanceMeters(a.location, pinTrusted) : Infinity) - (b.location ? distanceMeters(b.location, pinTrusted) : Infinity));
        const best = sorted[0];
        if (best?.location && distanceMeters(best.location, pinTrusted) <= 300 && sameName(parsed.name, best.name)) {
          return { status: 'located', place: withLink(best, sharedUrl), candidates: [] };
        }
        const pinned = { ...pinnedPlace(pinTrusted, parsed.name, null), formattedAddress: parsed.address ?? '', metadata: { source: 'shared-link', plusCode: parsed.plusCode } };
        return { status: 'choose', candidates: [pinned, ...sorted].map((c) => withLink(c, sharedUrl)), query };
      }
      return { status: 'choose', candidates: candidates.map((c) => withLink(c, sharedUrl)), query };
    }
    if (searchFailed) return unresolved(`Couldn’t search for “${query}”. Check your connection and try again, or add it by name.`);
    return unresolved(`No place called “${query}” was found. Search with a shorter name, or add it by name without a map location.`);
  }
  if (parsed.shortLink) {
    return unresolved(
      parsed.name
        ? `The Google Maps link couldn’t be opened right now. Search for “${parsed.name}” below, or add it by name.`
        : 'The Google Maps link couldn’t be opened (are you offline?). Try again online, search below, or long-press the pin in Google Maps and share the coordinates.',
    );
  }
  if (parsed.url) return unresolved('That link has no place or coordinates in it. Search for the place below, or add it by name.');
  return unresolved('Nothing that looks like a place was shared. Search for the place below.');
}

/** A node already in the plan that is the same place: same provider id, or within 120 m, or (unlocated) the same name. */
export function findSamePlace<N extends { id: string; name: string; place: { providerPlaceId: string | null; location: GeoPoint | null } | null }>(
  nodes: readonly N[],
  candidate: { providerPlaceId: string | null; name: string; location?: GeoPoint | null },
): N | null {
  const name = candidate.name.trim().toLowerCase();
  for (const n of nodes) {
    if (candidate.providerPlaceId && n.place?.providerPlaceId === candidate.providerPlaceId) return n;
    if (candidate.location && n.place?.location && distanceMeters(candidate.location, n.place.location) <= 120) return n;
  }
  return nodes.find((n) => n.name.trim().toLowerCase() === name) ?? null;
}
