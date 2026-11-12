import type { PlanNode } from '../planner/model';

/**
 * Google Maps URLs (https://developers.google.com/maps/documentation/urls).
 * Opening them hands off to the Google Maps app when installed, or the Maps
 * website otherwise; no API key is involved. Turn-by-turn navigation is always
 * Google Maps' job — Trip Prep only plans.
 */
export interface MapsLink {
  url: string;
  /** True when the link points at an exact place (coordinates / Place ID), not a text search. */
  exact: boolean;
}

type Placeable = Pick<PlanNode, 'name' | 'place'>;

const BASE = 'https://www.google.com/maps';

/**
 * How many intermediate stops ("waypoints") one directions link can carry
 * depends on where it opens. Google's Maps URLs documentation: "up to three
 * waypoints supported on mobile browsers, and a maximum of nine waypoints
 * supported otherwise"; every Maps URL is limited to 2,048 characters.
 *
 * - `app`: the Google Maps app on Android, launched explicitly (see
 *   openMaps.ts). The app plans at most 10 locations in one route (start +
 *   stops + destination), so a link carries an origin, at most 8 waypoints and
 *   a destination: 10 named locations.
 * - `browser`: anything else (mobile browser, desktop, iOS without a verified
 *   app hand-off): the mobile-browser limit of 3 waypoints, 5 named locations.
 *
 * Journeys that do not fit are split into linked legs, never shortened.
 */
export const MAPS_LIMITS = {
  app: { maxWaypoints: 8, maxLength: 2048 },
  browser: { maxWaypoints: 3, maxLength: 2048 },
} as const;
export type MapsTarget = keyof typeof MAPS_LIMITS;
export const MAPS_URL_MAX_WAYPOINTS = MAPS_LIMITS.browser.maxWaypoints;
export const MAPS_URL_MAX_LENGTH = 2048;

/**
 * `|` separates waypoints, so a name containing it would be read as two stops;
 * it becomes `/`. Everything else is kept and percent-encoded.
 */
function clean(value: string): string {
  return value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

/** Percent-encodes every value (spaces %20, commas %2C, `|` separators %7C), as Google's documentation asks. */
function query(params: [string, string][]): string {
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** The value Google Maps should look for: exact coordinates when known, otherwise the name (and address). */
function locationValue(node: Placeable): { value: string; placeId: string | null; exact: boolean } {
  const location = node.place?.location;
  const placeId = node.place?.provider === 'google' && node.place.providerPlaceId ? node.place.providerPlaceId : null;
  if (location) return { value: `${location.latitude},${location.longitude}`, placeId, exact: true };
  const address = node.place?.formattedAddress;
  return { value: clean(address ? `${node.name}, ${address}` : node.name), placeId, exact: false };
}

/** Shows a place on the map. */
export function placeLink(node: Placeable): MapsLink {
  const { value, placeId, exact } = locationValue(node);
  const params: [string, string][] = [['api', '1'], ['query', value]];
  if (exact && placeId) params.push(['query_place_id', placeId]);
  return { url: `${BASE}/search/?${query(params)}`, exact };
}

/** Directions from the current location to one place. */
export function navigateLink(node: Placeable): MapsLink {
  const { value, placeId, exact } = locationValue(node);
  const params: [string, string][] = [['api', '1'], ['destination', value]];
  if (placeId) params.push(['destination_place_id', placeId]);
  return { url: `${BASE}/dir/?${query(params)}`, exact };
}

/** Directions from `origin` (null = the device's current location) through `stops`; the last stop is the destination. */
export function directionsUrl(origin: Placeable | null, stops: readonly Placeable[]): string {
  const params: [string, string][] = [['api', '1']];
  if (origin) {
    const o = locationValue(origin);
    params.push(['origin', o.value]);
    if (o.placeId) params.push(['origin_place_id', o.placeId]);
  }
  const destination = locationValue(stops[stops.length - 1] as Placeable);
  params.push(['destination', destination.value]);
  if (destination.placeId) params.push(['destination_place_id', destination.placeId]);
  const waypoints = stops.slice(0, -1).map(locationValue);
  if (waypoints.length > 0) {
    params.push(['waypoints', waypoints.map((w) => w.value).join('|')]);
    // Place IDs must be given for every waypoint, or for none.
    if (waypoints.every((w) => w.placeId)) params.push(['waypoint_place_ids', waypoints.map((w) => w.placeId).join('|')]);
  }
  return `${BASE}/dir/?${query(params)}`;
}

export interface JourneyLeg<T extends Placeable> {
  /** 1-based leg number. */
  number: number;
  /** Where the leg starts: null = the device's current location (a one-place journey). */
  from: T | null;
  /** Stops reached in this leg, in order (the last one is the leg's destination). */
  stops: T[];
  /** 1-based positions in the journey of the leg's first and last named location. */
  firstPosition: number;
  lastPosition: number;
  url: string;
}

/**
 * Splits an ordered journey into Google Maps directions links. The first
 * location is the starting point (origin) and the last is the destination;
 * with only one location, directions start from the current location. Each
 * leg after the first starts at the previous leg's destination, so every
 * location appears once (the shared hand-over point is the end of one leg and
 * the start of the next) and nothing is dropped.
 */
export function journeyLegs<T extends Placeable>(
  stops: readonly T[],
  target: MapsTarget | { maxWaypoints: number; maxLength: number } = 'browser',
): JourneyLeg<T>[] {
  const { maxWaypoints, maxLength } = typeof target === 'string' ? MAPS_LIMITS[target] : target;
  if (stops.length === 0) return [];
  if (stops.length === 1) {
    const only = stops[0] as T;
    return [{ number: 1, from: null, stops: [only], firstPosition: 1, lastPosition: 1, url: directionsUrl(null, [only]) }];
  }
  const legs: JourneyLeg<T>[] = [];
  let start = 0; // index of the leg's origin
  while (start < stops.length - 1) {
    const from = stops[start] as T;
    // Up to maxWaypoints + 1 locations after the origin, fewer if the URL would be too long.
    let size = Math.min(maxWaypoints + 1, stops.length - 1 - start);
    let url = directionsUrl(from, stops.slice(start + 1, start + 1 + size));
    while (url.length > maxLength && size > 1) {
      size -= 1;
      url = directionsUrl(from, stops.slice(start + 1, start + 1 + size));
    }
    legs.push({ number: legs.length + 1, from, stops: stops.slice(start + 1, start + 1 + size), firstPosition: start + 1, lastPosition: start + 1 + size, url });
    start += size;
  }
  return legs;
}
