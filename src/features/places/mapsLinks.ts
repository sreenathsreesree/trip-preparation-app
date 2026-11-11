import type { PlanNode } from '../planner/model';

/**
 * Google Maps URLs (https://developers.google.com/maps/documentation/urls).
 * Opening them hands off to the Maps app or website; no API key is involved.
 */
export interface MapsLink {
  url: string;
  /** True when the link points at an exact place (coordinates / Place ID), not a text search. */
  exact: boolean;
}

export function placeLink(node: Pick<PlanNode, 'name' | 'place'>): MapsLink {
  const params = new URLSearchParams({ api: '1' });
  const location = node.place?.location;
  if (location) {
    params.set('query', `${location.latitude},${location.longitude}`);
    if (node.place?.provider === 'google' && node.place.providerPlaceId) {
      params.set('query_place_id', node.place.providerPlaceId);
    }
    return { url: `https://www.google.com/maps/search/?${params.toString()}`, exact: true };
  }
  const address = node.place?.formattedAddress;
  params.set('query', address ? `${node.name}, ${address}` : node.name);
  return { url: `https://www.google.com/maps/search/?${params.toString()}`, exact: false };
}
