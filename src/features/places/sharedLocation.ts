import { distanceMeters } from '../planner/arrival';
import { isValidLocation, type GeoPoint } from '../planner/model';
import { OSM_ATTRIBUTION, placeFromPhoton } from './osm';
import { PHOTON_URL } from './osmProvider';
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
  /** A place name taken from the link or the shared text. */
  name: string | null;
  /** Free text worth searching for when there are no coordinates. */
  query: string | null;
  /** A short link that must be opened (followed) to read the place. */
  shortLink: string | null;
  /** The first link found, if any. */
  url: string | null;
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
export function parseMapsUrl(url: string): { location: GeoPoint | null; name: string | null } {
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
    const value = q ? decode(q[1] ?? '').trim() : '';
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
  return { location, name: name || null };
}

/** Parses pasted or shared text. Pure; see `resolveShare` for the online steps. */
export function parseShare(input: string, subject?: string | null): ParsedShare {
  const text = input.trim();
  const out: ParsedShare = { location: null, name: null, query: null, shortLink: null, url: null };
  if (!text) return out;

  const direct = parseCoordinates(text);
  if (direct) return { ...out, location: direct };

  const url = URL_RE.exec(text)?.[0]?.replace(/[).,]+$/, '') ?? null;
  out.url = url;
  if (url) {
    if (SHORT_RE.test(url)) out.shortLink = url;
    else Object.assign(out, parseMapsUrl(url));
  }
  // Text around the link: Google Maps shares "Name\nAddress\nlink" (or "Name, address link").
  const rest = (url ? text.replace(url, ' ') : text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:/i.test(l));
  if (!out.location) {
    for (const line of rest) {
      const p = parseCoordinates(line);
      if (p) {
        out.location = p;
        break;
      }
    }
  }
  const textName = rest.find((l) => !parseCoordinates(l)) ?? (subject?.trim() || null);
  if (!out.name && textName) out.name = textName.replace(/\s+/g, ' ').slice(0, 120);
  if (!out.location && (out.name || (!url && text))) {
    out.query = [out.name, rest.slice(1, 2).join(' ')].filter(Boolean).join(', ').slice(0, 160) || text.slice(0, 160);
  }
  return out;
}

export type ResolvedShare =
  | { status: 'located'; place: PlaceDetails; candidates: PlaceDetails[] }
  | { status: 'choose'; candidates: PlaceDetails[]; query: string }
  | { status: 'unresolved'; reason: string };

export interface ResolveDeps {
  fetchImpl?: typeof fetch;
  provider: Pick<PlacesProvider, 'textSearch' | 'configured'>;
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
    providerPlaceId: near && (!name || name === near.name) ? near.providerPlaceId : null,
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
  } as PlaceDetails;
}

/** Turns pasted/shared text into a place to preview, following short links and searching by name when needed. */
export async function resolveShare(input: string, deps: ResolveDeps, subject?: string | null): Promise<ResolvedShare> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let parsed = parseShare(input, subject);
  if (parsed.shortLink) {
    const finalUrl = await followShortLink(parsed.shortLink, fetchImpl, deps.signal);
    if (finalUrl) {
      const fromUrl = parseMapsUrl(finalUrl);
      parsed = { ...parsed, location: parsed.location ?? fromUrl.location, name: fromUrl.name ?? parsed.name };
    }
  }
  if (parsed.location) {
    const nearby = await reverseGeocode(parsed.location, fetchImpl, deps.signal);
    return { status: 'located', place: pinnedPlace(parsed.location, parsed.name, nearby), candidates: [] };
  }
  const query = parsed.name ?? parsed.query;
  if (query && deps.provider.configured) {
    try {
      const candidates = await deps.provider.textSearch({ query, maxResults: 6 }, deps.signal);
      if (candidates.length) return { status: 'choose', candidates, query };
    } catch {
      return { status: 'unresolved', reason: `Couldn’t search for “${query}”. Check your connection and try again.` };
    }
    return { status: 'unresolved', reason: `No place called “${query}” was found. Try a shorter name, or share the place again with its pin.` };
  }
  if (parsed.shortLink) {
    return { status: 'unresolved', reason: 'The Google Maps short link couldn’t be opened (are you offline?). Try again online, or long-press the pin in Google Maps and share the coordinates.' };
  }
  if (parsed.url) return { status: 'unresolved', reason: 'That link has no place or coordinates in it.' };
  return { status: 'unresolved', reason: 'Nothing that looks like a place was shared.' };
}

/** A node already in the plan that is the same place: same provider id, or within 120 m, or (unlocated) the same name. */
export function findSamePlace<N extends { id: string; name: string; place: { providerPlaceId: string | null; location: GeoPoint | null } | null }>(
  nodes: readonly N[],
  candidate: Pick<PlaceDetails, 'providerPlaceId' | 'name' | 'location'>,
): N | null {
  const name = candidate.name.trim().toLowerCase();
  for (const n of nodes) {
    if (candidate.providerPlaceId && n.place?.providerPlaceId === candidate.providerPlaceId) return n;
    if (candidate.location && n.place?.location && distanceMeters(candidate.location, n.place.location) <= 120) return n;
  }
  return nodes.find((n) => n.name.trim().toLowerCase() === name) ?? null;
}
