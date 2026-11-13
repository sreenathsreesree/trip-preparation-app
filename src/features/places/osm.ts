import type { GeoPoint } from '../planner/model';
import type { PlaceDetails, PlaceSuggestion } from './provider';

/**
 * OpenStreetMap data (pure helpers). Free and keyless; the data is © OpenStreetMap
 * contributors under the ODbL, which allows storing it (unlike Google content),
 * as long as it is attributed. Places from here are saved as ordinary places
 * ("manual" provider, so the cloud accepts names and coordinates) with an
 * `osm:<type><id>` id that prevents duplicates.
 */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Overpass QL for named places matching any selector within `radiusMeters`. */
export function overpassQuery(selectors: readonly string[], center: GeoPoint, radiusMeters: number, limit = 60): string {
  const around = `(around:${Math.round(radiusMeters)},${center.latitude.toFixed(5)},${center.longitude.toFixed(5)})`;
  const parts = selectors.map((s) => `  nwr${s}["name"]${around};`).join('\n');
  return `[out:json][timeout:25];\n(\n${parts}\n);\nout center tags ${limit};`;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const TYPE_KEYS = ['tourism', 'historic', 'natural', 'waterway', 'leisure', 'boundary', 'amenity', 'crop', 'craft'] as const;

export const osmPlaceId = (type: string, id: number | string) => `osm:${type.charAt(0)}${id}`;

/** Normalises one Overpass element; null when it has no name or no position (never invented). */
export function placeFromOverpass(el: OverpassElement): PlaceDetails | null {
  const tags = el.tags ?? {};
  const name = (tags['name:en'] ?? tags.name ?? '').trim();
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!name || typeof lat !== 'number' || typeof lon !== 'number') return null;
  const types = TYPE_KEYS.filter((k) => tags[k]).map((k) => `${k}=${tags[k]}`);
  const address = [tags['addr:street'], tags['addr:city'] ?? tags['addr:village'] ?? tags['addr:town'], tags['addr:state']].filter(Boolean).join(', ');
  return {
    provider: 'manual',
    providerPlaceId: osmPlaceId(el.type, el.id),
    name,
    location: { latitude: lat, longitude: lon },
    formattedAddress: address,
    types,
    district: tags['addr:district'] ?? null,
    state: tags['addr:state'] ?? null,
    country: tags['addr:country'] ?? null,
    metadata: { source: 'osm', osmType: el.type, osmId: el.id, ...(tags.wikipedia ? { wikipedia: tags.wikipedia } : {}), ...(tags.wikidata ? { wikidata: tags.wikidata } : {}) },
    rating: null,
    userRatingCount: null,
    editorialSummary: tags.description ?? null,
    photos: [],
    mapsUri: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    attributions: [OSM_ATTRIBUTION],
  };
}

/**
 * Places from an Overpass response, one per id. OSM has no ratings, so
 * "popular" means well documented: places with a Wikipedia/Wikidata entry first.
 */
export function placesFromOverpass(body: unknown): PlaceDetails[] {
  const elements = Array.isArray((body as { elements?: unknown })?.elements) ? ((body as { elements: OverpassElement[] }).elements) : [];
  const seen = new Set<string>();
  const out: PlaceDetails[] = [];
  for (const el of elements) {
    const place = placeFromOverpass(el);
    if (!place || seen.has(place.providerPlaceId)) continue;
    seen.add(place.providerPlaceId);
    out.push(place);
  }
  const notable = (p: PlaceDetails) => (p.metadata?.wikipedia ? 2 : 0) + (p.metadata?.wikidata ? 1 : 0);
  return out.map((p, i) => ({ p, i })).sort((a, b) => notable(b.p) - notable(a.p) || a.i - b.i).map((x) => x.p);
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

/** Normalises a Photon (OSM geocoder) feature to a place. */
export function placeFromPhoton(f: PhotonFeature): PlaceDetails | null {
  const p = f.properties ?? {};
  const coords = f.geometry?.coordinates;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  if (!name || !coords || typeof p.osm_id !== 'number' || typeof p.osm_type !== 'string') return null;
  const type = p.osm_type === 'N' ? 'node' : p.osm_type === 'W' ? 'way' : 'relation';
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    provider: 'manual',
    providerPlaceId: osmPlaceId(type, p.osm_id),
    name,
    location: { latitude: coords[1], longitude: coords[0] },
    formattedAddress: [str(p.city) ?? str(p.county), str(p.state), str(p.country)].filter(Boolean).join(', '),
    types: p.osm_key && p.osm_value ? [`${p.osm_key}=${p.osm_value}`] : [],
    district: str(p.county),
    state: str(p.state),
    country: str(p.country),
    metadata: { source: 'osm', osmType: type, osmId: p.osm_id },
    rating: null,
    userRatingCount: null,
    editorialSummary: null,
    photos: [],
    mapsUri: `https://www.openstreetmap.org/${type}/${p.osm_id}`,
    attributions: [OSM_ATTRIBUTION],
  };
}

export function placesFromPhoton(body: unknown): PlaceDetails[] {
  const features = Array.isArray((body as { features?: unknown })?.features) ? (body as { features: PhotonFeature[] }).features : [];
  return features.flatMap((f) => {
    const place = placeFromPhoton(f);
    return place ? [place] : [];
  });
}

export function suggestionFromPlace(place: PlaceDetails, from: GeoPoint | null, distance: (a: GeoPoint, b: GeoPoint) => number): PlaceSuggestion {
  return {
    providerPlaceId: place.providerPlaceId,
    primaryText: place.name,
    secondaryText: place.formattedAddress ?? '',
    types: [...(place.types ?? [])],
    distanceMeters: from && place.location ? distance(from, place.location) : null,
  };
}
