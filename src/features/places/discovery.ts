import type { IconName } from '@/theme/icons';

import { distanceMeters } from '../planner/arrival';
import { ancestorIds, type GeoPoint, type PlanNode } from '../planner/model';
import type { PlaceDetails } from './provider';

/**
 * Recommendation logic (pure). Results always come from the live provider;
 * nothing here invents places, ratings, hours or distances.
 */

export const DISTANCE_FILTERS_KM = [5, 10, 25, 50] as const;
export type DistanceKm = (typeof DISTANCE_FILTERS_KM)[number];

export type DiscoverySearch =
  | { kind: 'nearby'; includedTypes: readonly string[] }
  | { kind: 'text'; query: string };

export interface DiscoveryCategory {
  key: string;
  label: string;
  icon: IconName;
  search: DiscoverySearch;
  /** OpenStreetMap tag selectors (Overpass syntax) for the same category. */
  osm: readonly string[];
}

/** Google Places (New) place types / text queries per category. */
export const DISCOVERY_CATEGORIES: readonly DiscoveryCategory[] = [
  { key: 'attractions', label: 'Attractions', icon: 'star-outline', search: { kind: 'nearby', includedTypes: ['tourist_attraction', 'museum', 'historical_landmark'] }, osm: ['["tourism"="attraction"]', '["tourism"="museum"]', '["historic"~"^(monument|castle|fort|ruins|archaeological_site)$"]', '["amenity"="place_of_worship"]["wikidata"]'] },
  { key: 'viewpoints', label: 'Viewpoints', icon: 'binoculars', search: { kind: 'text', query: 'viewpoint' }, osm: ['["tourism"="viewpoint"]'] },
  { key: 'waterfalls', label: 'Waterfalls', icon: 'waves', search: { kind: 'text', query: 'waterfall' }, osm: ['["natural"="waterfall"]', '["waterway"="waterfall"]'] },
  { key: 'nature', label: 'Nature', icon: 'pine-tree', search: { kind: 'nearby', includedTypes: ['park', 'national_park', 'hiking_area'] }, osm: ['["leisure"="park"]', '["leisure"="nature_reserve"]', '["boundary"="national_park"]', '["natural"="peak"]', '["natural"="beach"]'] },
  { key: 'tea', label: 'Tea estates', icon: 'leaf', search: { kind: 'text', query: 'tea estate' }, osm: ['["crop"="tea"]', '["tourism"]["name"~"[Tt]ea"]', '["craft"="tea"]'] },
  { key: 'food', label: 'Restaurants', icon: 'silverware-fork-knife', search: { kind: 'nearby', includedTypes: ['restaurant', 'cafe'] }, osm: ['["amenity"="restaurant"]', '["amenity"="cafe"]'] },
];

const TYPE_LABELS: Record<string, string> = {
  tourist_attraction: 'Attraction',
  museum: 'Museum',
  historical_landmark: 'Historical landmark',
  park: 'Park',
  national_park: 'National park',
  hiking_area: 'Hiking area',
  restaurant: 'Restaurant',
  cafe: 'Café',
  lodging: 'Stay',
  hindu_temple: 'Temple',
  church: 'Church',
  mosque: 'Mosque',
  zoo: 'Zoo',
  beach: 'Beach',
  natural_feature: 'Nature',
};

/** A readable category for a place from its provider types (or null). */
export function typeLabel(types: readonly string[]): string | null {
  for (const type of types) {
    const label = TYPE_LABELS[type];
    if (label) return label;
  }
  return null;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/**
 * Where recommendations are centred: the place's own coordinates, or the
 * nearest place above it that has coordinates (e.g. a nested spot inside
 * Munnar uses Munnar). Null when nothing has a verified location.
 */
export function contextLocation(nodes: readonly PlanNode[], nodeId: string | null): { location: GeoPoint; from: PlanNode } | null {
  if (!nodeId) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of [nodeId, ...ancestorIds(nodes, nodeId)]) {
    const node = byId.get(id);
    if (node?.place?.location) return { location: node.place.location, from: node };
  }
  return null;
}

export type RecommendationSort = 'relevance' | 'distance' | 'rating';

export interface Recommendation {
  place: PlaceDetails;
  /** Straight-line distance from the destination (metres), when both have coordinates. */
  distanceMeters: number | null;
  /** Already in this trip's plan (by Place ID). */
  inPlan: boolean;
}

/**
 * Turns provider results into recommendations: one per Place ID, outside the
 * distance limit dropped, places already in the plan marked, then sorted.
 * "Relevance" keeps the provider's order.
 */
export function rankRecommendations(
  places: readonly PlaceDetails[],
  origin: GeoPoint,
  radiusKm: number,
  planPlaceIds: ReadonlySet<string> | ((place: PlaceDetails) => boolean),
  sort: RecommendationSort = 'relevance',
): Recommendation[] {
  const inPlan = typeof planPlaceIds === 'function' ? planPlaceIds : (p: PlaceDetails) => planPlaceIds.has(p.providerPlaceId);
  const seen = new Set<string>();
  const result: Recommendation[] = [];
  for (const place of places) {
    if (seen.has(place.providerPlaceId)) continue;
    seen.add(place.providerPlaceId);
    const distance = place.location ? distanceMeters(origin, place.location) : null;
    if (distance !== null && distance > radiusKm * 1000) continue;
    result.push({ place, distanceMeters: distance, inPlan: inPlan(place) });
  }
  if (sort === 'distance') result.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  if (sort === 'rating') {
    // Rating weighted by how many people rated it, so one 5★ review does not win.
    const score = (r: Recommendation) => (r.place.rating ?? 0) * Math.log10(1 + (r.place.userRatingCount ?? 0));
    result.sort((a, b) => score(b) - score(a));
  }
  return result;
}

/** Placement choices for a recommendation (exactly one per tap). */
export type Placement = 'inside' | 'route' | 'main';

/** Lower-case letters and digits only, so "Mattupetty Dam" and "mattupetty-dam" compare equal. */
export const normalizePlaceName = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

export const DUPLICATE_RADIUS_METERS = 300;

/**
 * Whether a found place is already in the plan: same provider id, or the same
 * name at (about) the same spot — so a place typed in by hand is not added
 * again from recommendations. Same name without coordinates counts too.
 */
export function planMatcher(nodes: readonly Pick<PlanNode, 'name' | 'place'>[]): (place: Pick<PlaceDetails, 'providerPlaceId' | 'name' | 'location'>) => boolean {
  const ids = new Set(nodes.flatMap((n) => (n.place?.providerPlaceId ? [n.place.providerPlaceId] : [])));
  const byName = new Map<string, (GeoPoint | null)[]>();
  for (const n of nodes) {
    const key = normalizePlaceName(n.name);
    byName.set(key, [...(byName.get(key) ?? []), n.place?.location ?? null]);
  }
  return (place) => {
    if (ids.has(place.providerPlaceId)) return true;
    const spots = byName.get(normalizePlaceName(place.name));
    if (!spots) return false;
    return spots.some((spot) => !spot || !place.location || distanceMeters(spot, place.location) <= DUPLICATE_RADIUS_METERS);
  };
}
