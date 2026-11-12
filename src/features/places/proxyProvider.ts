import type { GeoPoint } from '../planner/model';
import {
  PlacesError,
  type AutocompleteRequest,
  type NearbyRequest,
  type PlaceDetails,
  type PlacePhotoRef,
  type PlaceSuggestion,
  type PlacesErrorKind,
  type PlacesProvider,
  type TextSearchRequest,
} from './provider';

/**
 * Places provider backed by Trip Prep's own places proxy (see
 * server/places-proxy). The proxy holds the Google key, enforces field masks
 * and limits, and returns normalised JSON; the app never sees a Google key.
 *
 * Contract (POST JSON, response `{ ... }` or `{ error: PlacesErrorKind }`):
 *   /autocomplete { input, sessionToken, bias? }        → { suggestions: PlaceSuggestion[] }
 *   /details      { placeId, sessionToken? }            → { place: PlaceDetails }
 *   /nearby       { location, radiusMeters, includedTypes?, maxResults? } → { places: PlaceDetails[] }
 *   /text         { query, bias?, maxResults? }         → { places: PlaceDetails[] }
 *   GET /photo?name=…&maxWidthPx=…                       → image bytes
 */

const ERROR_KINDS: readonly PlacesErrorKind[] = [
  'not_configured',
  'offline',
  'network',
  'quota',
  'denied',
  'not_found',
  'invalid_request',
  'cancelled',
  'unknown',
];

function kindForStatus(status: number): PlacesErrorKind {
  if (status === 429) return 'quota';
  if (status === 401 || status === 403) return 'denied';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid_request';
  if (status === 503) return 'not_configured';
  return 'network';
}

const isGeo = (v: unknown): v is GeoPoint =>
  typeof v === 'object' && v !== null && typeof (v as GeoPoint).latitude === 'number' && typeof (v as GeoPoint).longitude === 'number';

/** Keeps only well-formed places; never invents missing values. */
export function sanitizePlace(value: unknown): PlaceDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.providerPlaceId !== 'string' || typeof v.name !== 'string' || !v.name.trim()) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : null);
  const photos: PlacePhotoRef[] = Array.isArray(v.photos)
    ? v.photos.flatMap((p) => {
        const photo = p as Partial<PlacePhotoRef>;
        return typeof photo.name === 'string'
          ? [
              {
                name: photo.name,
                widthPx: num(photo.widthPx) ?? 0,
                heightPx: num(photo.heightPx) ?? 0,
                authorAttributions: Array.isArray(photo.authorAttributions)
                  ? photo.authorAttributions.flatMap((a) =>
                      typeof a?.displayName === 'string' ? [{ displayName: a.displayName, uri: str(a.uri) }] : [],
                    )
                  : [],
              },
            ]
          : [];
      })
    : [];
  return {
    provider: 'google',
    providerPlaceId: v.providerPlaceId,
    name: v.name.trim(),
    location: isGeo(v.location) ? v.location : null,
    formattedAddress: str(v.formattedAddress) ?? '',
    types: Array.isArray(v.types) ? v.types.filter((t): t is string => typeof t === 'string') : [],
    district: str(v.district),
    state: str(v.state),
    country: str(v.country),
    metadata: typeof v.metadata === 'object' && v.metadata !== null ? (v.metadata as Record<string, unknown>) : {},
    rating: num(v.rating),
    userRatingCount: num(v.userRatingCount),
    editorialSummary: str(v.editorialSummary),
    photos,
    mapsUri: str(v.mapsUri),
    attributions: Array.isArray(v.attributions) ? v.attributions.filter((a): a is string => typeof a === 'string') : [],
  };
}

export function createProxyProvider(baseUrl: string, fetchImpl: typeof fetch = fetch): PlacesProvider {
  const base = baseUrl.replace(/\/+$/, '');

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new PlacesError('cancelled');
      throw new PlacesError('network');
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const reported = (json as { error?: unknown } | null)?.error;
    if (!response.ok || reported) {
      const kind = typeof reported === 'string' && (ERROR_KINDS as readonly string[]).includes(reported) ? (reported as PlacesErrorKind) : kindForStatus(response.status);
      throw new PlacesError(kind);
    }
    return json as T;
  }

  const places = (value: unknown): PlaceDetails[] =>
    Array.isArray(value) ? value.flatMap((p) => {
      const clean = sanitizePlace(p);
      return clean ? [clean] : [];
    }) : [];

  return {
    id: 'google',
    configured: true,
    async autocomplete(request: AutocompleteRequest, signal) {
      const result = await post<{ suggestions?: PlaceSuggestion[] }>('/autocomplete', request, signal);
      return Array.isArray(result.suggestions) ? result.suggestions.filter((s) => typeof s?.providerPlaceId === 'string') : [];
    },
    async details(providerPlaceId, options, signal) {
      const result = await post<{ place?: unknown }>('/details', { placeId: providerPlaceId, sessionToken: options.sessionToken }, signal);
      const place = sanitizePlace(result.place);
      if (!place) throw new PlacesError('not_found');
      return place;
    },
    async nearby(request: NearbyRequest, signal) {
      return places((await post<{ places?: unknown }>('/nearby', request, signal)).places);
    },
    async textSearch(request: TextSearchRequest, signal) {
      return places((await post<{ places?: unknown }>('/text', request, signal)).places);
    },
    photoUrl(photo, maxWidthPx) {
      return `${base}/photo?${new URLSearchParams({ name: photo.name, maxWidthPx: String(Math.round(maxWidthPx)) }).toString()}`;
    },
  };
}
