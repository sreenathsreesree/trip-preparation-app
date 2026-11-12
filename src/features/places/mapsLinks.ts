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
 * Directions links accept a limited number of intermediate stops ("waypoints"),
 * and the documented limit differs by platform (Google's page states only the
 * 2,048-character URL limit; widely cited limits are 3 waypoints in mobile
 * browsers and 9 elsewhere). The strictest figure is used so every link works
 * everywhere; longer journeys are split into legs, never shortened.
 */
export const MAPS_URL_MAX_WAYPOINTS = 3;
export const MAPS_URL_MAX_LENGTH = 2048;

/** The value Google Maps should look for: exact coordinates when known, otherwise the name (and address). */
function locationValue(node: Placeable): { value: string; placeId: string | null; exact: boolean } {
  const location = node.place?.location;
  const placeId = node.place?.provider === 'google' && node.place.providerPlaceId ? node.place.providerPlaceId : null;
  if (location) return { value: `${location.latitude},${location.longitude}`, placeId, exact: true };
  const address = node.place?.formattedAddress;
  return { value: address ? `${node.name}, ${address}` : node.name, placeId, exact: false };
}

/** Shows a place on the map. */
export function placeLink(node: Placeable): MapsLink {
  const params = new URLSearchParams({ api: '1' });
  const { value, placeId, exact } = locationValue(node);
  params.set('query', value);
  if (exact && placeId) params.set('query_place_id', placeId);
  return { url: `${BASE}/search/?${params.toString()}`, exact };
}

/** Directions from the current location to one place. */
export function navigateLink(node: Placeable): MapsLink {
  const params = new URLSearchParams({ api: '1' });
  const { value, placeId, exact } = locationValue(node);
  params.set('destination', value);
  if (placeId) params.set('destination_place_id', placeId);
  return { url: `${BASE}/dir/?${params.toString()}`, exact };
}

function directionsUrl(origin: Placeable | null, stops: readonly Placeable[]): string {
  const params = new URLSearchParams({ api: '1' });
  const destination = locationValue(stops[stops.length - 1] as Placeable);
  if (origin) {
    const o = locationValue(origin);
    params.set('origin', o.value);
    if (o.placeId) params.set('origin_place_id', o.placeId);
  }
  params.set('destination', destination.value);
  if (destination.placeId) params.set('destination_place_id', destination.placeId);
  const waypoints = stops.slice(0, -1).map(locationValue);
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map((w) => w.value).join('|'));
    // Place IDs must be given for every waypoint, or for none.
    if (waypoints.every((w) => w.placeId)) params.set('waypoint_place_ids', waypoints.map((w) => w.placeId).join('|'));
  }
  return `${BASE}/dir/?${params.toString()}`;
}

export interface JourneyLeg<T extends Placeable> {
  /** 1-based leg number. */
  number: number;
  /** Where the leg starts: null = the device's current location (first leg). */
  from: T | null;
  /** Stops reached in this leg, in order (the last one is the leg's destination). */
  stops: T[];
  url: string;
}

/**
 * Splits an ordered journey into Google Maps directions links. The first leg
 * starts from the current location; each later leg starts at the previous
 * leg's last stop. Every stop appears in exactly one leg; nothing is dropped.
 */
export function journeyLegs<T extends Placeable>(
  stops: readonly T[],
  maxWaypoints = MAPS_URL_MAX_WAYPOINTS,
  maxLength = MAPS_URL_MAX_LENGTH,
): JourneyLeg<T>[] {
  const legs: JourneyLeg<T>[] = [];
  let from: T | null = null;
  let index = 0;
  while (index < stops.length) {
    // Up to maxWaypoints + 1 stops per leg, fewer if the URL would be too long.
    let size = Math.min(maxWaypoints + 1, stops.length - index);
    let url = directionsUrl(from, stops.slice(index, index + size));
    while (url.length > maxLength && size > 1) {
      size -= 1;
      url = directionsUrl(from, stops.slice(index, index + size));
    }
    const legStops = stops.slice(index, index + size);
    legs.push({ number: legs.length + 1, from, stops: legStops, url });
    from = legStops[legStops.length - 1] ?? null;
    index += size;
  }
  return legs;
}
