import { distanceMeters } from '../planner/arrival';
import { OSM_ATTRIBUTION, overpassQuery, placesFromOverpass, placesFromPhoton, suggestionFromPlace } from './osm';
import { PlacesError, type PlaceDetails, type PlacesProvider } from './provider';

/**
 * Live places from OpenStreetMap, free and without any key or billing:
 * - Photon (photon.komoot.io): place search / autocomplete (allowed by its usage policy).
 * - Overpass API (overpass-api.de): places of a category around a destination.
 * Both are community services: requests are spaced out (at most one per
 * second per service), results are cached by the caller, and every result is
 * attributed. Only place names and coordinates are sent — nothing personal.
 */
export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MIN_GAP_MS = 1100;

function spacer() {
  let last = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return task();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export function createOsmProvider(fetchImpl: typeof fetch = (...args) => fetch(...args)): PlacesProvider {
  const photonQueue = spacer();
  const overpassQueue = spacer();
  /** Details are what search returned (OSM has no separate details call). */
  const known = new Map<string, PlaceDetails>();

  async function get(url: string, init: RequestInit | undefined, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal, headers: { Accept: 'application/json', ...(init?.headers as Record<string, string>) } });
    } catch (error) {
      if (signal?.aborted) throw new PlacesError('cancelled');
      throw new PlacesError(error instanceof TypeError ? 'offline' : 'network');
    }
    if (response.status === 429 || response.status === 504) throw new PlacesError('quota');
    if (!response.ok) throw new PlacesError(response.status >= 500 ? 'network' : 'invalid_request');
    return response.json();
  }

  const remember = (places: PlaceDetails[]) => {
    for (const p of places) known.set(p.providerPlaceId, p);
    return places;
  };

  async function photon(query: string, bias: { latitude: number; longitude: number } | null | undefined, limit: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (bias) {
      params.set('lat', bias.latitude.toFixed(4));
      params.set('lon', bias.longitude.toFixed(4));
    }
    return remember(placesFromPhoton(await photonQueue(() => get(`${PHOTON_URL}?${params.toString()}`, undefined, signal))));
  }

  return {
    id: 'manual',
    configured: true,
    source: { kind: 'live', name: 'OpenStreetMap', attribution: OSM_ATTRIBUTION },
    async autocomplete(request, signal) {
      const places = await photon(request.input, request.bias ?? null, 6, signal);
      return places.map((p) => suggestionFromPlace(p, request.bias ?? null, distanceMeters));
    },
    async details(providerPlaceId) {
      const place = known.get(providerPlaceId);
      if (!place) throw new PlacesError('not_found');
      return place;
    },
    async nearby(request, signal) {
      // Generic "things to see" around a point.
      return this.discover!({ selectors: ['["tourism"]'], category: 'nearby', location: request.location, radiusMeters: request.radiusMeters, maxResults: request.maxResults }, signal);
    },
    async textSearch(request, signal) {
      return photon(request.query, request.bias ?? null, request.maxResults ?? 10, signal);
    },
    async discover(request, signal) {
      const body = new URLSearchParams({ data: overpassQuery(request.selectors, request.location, request.radiusMeters, Math.max(20, (request.maxResults ?? 20) * 3)) });
      const json = await overpassQueue(() =>
        get(OVERPASS_URL, { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, signal),
      );
      return remember(placesFromOverpass(json)).slice(0, request.maxResults ?? 20);
    },
    photoUrl: () => null,
  };
}
