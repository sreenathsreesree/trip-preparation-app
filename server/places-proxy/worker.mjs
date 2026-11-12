// Trip Prep places proxy — reference implementation (NOT deployed).
//
// Holds the Google Places API key as a secret so the app never ships it, fixes
// the field masks (which decide Google's billing tier), caps radius / result
// counts, and returns the normalised shape the app expects
// (src/features/places/proxyProvider.ts).
//
// Requires a Google Cloud project with "Places API (New)" enabled AND a billing
// account linked. Deploying this (and any billing) needs the owner's approval.
// Verify the endpoints and field names below against the current Places API
// (New) documentation before deploying.
//
//   wrangler secret put GOOGLE_PLACES_KEY
//   wrangler deploy
//   → set EXPO_PUBLIC_PLACES_PROXY_URL=https://<worker>.workers.dev in EAS

const GOOGLE = 'https://places.googleapis.com/v1';
const MAX_RADIUS_M = 50_000;
const MAX_RESULTS = 20;

// Only what the app shows. Ratings, photos, hours and summaries are higher tiers;
// they are requested for recommendations only and never stored by the app.
const PLACE_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'userRatingCount',
  'photos',
  'googleMapsUri',
  'editorialSummary',
  'currentOpeningHours.openNow',
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const errorKind = (status) => (status === 429 ? 'quota' : status === 403 || status === 401 ? 'denied' : status === 404 ? 'not_found' : status === 400 ? 'invalid_request' : 'network');

function normalise(place) {
  if (!place || typeof place.id !== 'string') return null;
  return {
    providerPlaceId: place.id,
    name: place.displayName?.text ?? '',
    location: place.location ? { latitude: place.location.latitude, longitude: place.location.longitude } : null,
    formattedAddress: place.formattedAddress ?? '',
    types: Array.isArray(place.types) ? place.types : [],
    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    editorialSummary: place.editorialSummary?.text ?? null,
    photos: (place.photos ?? []).slice(0, 3).map((p) => ({
      name: p.name,
      widthPx: p.widthPx ?? 0,
      heightPx: p.heightPx ?? 0,
      authorAttributions: (p.authorAttributions ?? []).map((a) => ({ displayName: a.displayName ?? '', uri: a.uri ?? null })),
    })),
    mapsUri: place.googleMapsUri ?? null,
    metadata: typeof place.currentOpeningHours?.openNow === 'boolean' ? { openNow: place.currentOpeningHours.openNow } : {},
    attributions: ['Google Maps'],
  };
}

const circle = (point, radius) => ({ circle: { center: { latitude: Number(point.latitude), longitude: Number(point.longitude) }, radius } });
const isPoint = (p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));

async function google(env, path, body, mask) {
  const response = await fetch(`${GOOGLE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': mask },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) return { error: errorKind(response.status) };
  return { data: await response.json() };
}

export default {
  async fetch(request, env) {
    if (!env.GOOGLE_PLACES_KEY) return json({ error: 'not_configured' }, 503);
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/photo') {
        const name = url.searchParams.get('name') ?? '';
        const width = Math.min(1600, Math.max(64, Number(url.searchParams.get('maxWidthPx')) || 640));
        if (!/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return json({ error: 'invalid_request' }, 400);
        const image = await fetch(`${GOOGLE}/${name}/media?maxWidthPx=${width}&key=${env.GOOGLE_PLACES_KEY}`);
        if (!image.ok) return json({ error: errorKind(image.status) }, image.status);
        return new Response(image.body, { headers: { 'Content-Type': image.headers.get('Content-Type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
      }
      if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
      const body = await request.json().catch(() => ({}));
      const results = Math.min(MAX_RESULTS, Math.max(1, Number(body.maxResults) || 10));

      if (url.pathname === '/nearby') {
        if (!isPoint(body.location)) return json({ error: 'invalid_request' }, 400);
        const radius = Math.min(MAX_RADIUS_M, Math.max(100, Number(body.radiusMeters) || 5000));
        const types = Array.isArray(body.includedTypes) ? body.includedTypes.filter((t) => typeof t === 'string').slice(0, 5) : undefined;
        const { data, error } = await google(
          env,
          '/places:searchNearby',
          { includedTypes: types, maxResultCount: results, locationRestriction: circle(body.location, radius) },
          PLACE_FIELDS.map((f) => `places.${f}`).join(','),
        );
        return error ? json({ error }) : json({ places: (data.places ?? []).map(normalise).filter(Boolean) });
      }
      if (url.pathname === '/text') {
        const query = String(body.query ?? '').slice(0, 100).trim();
        if (!query) return json({ error: 'invalid_request' }, 400);
        const { data, error } = await google(
          env,
          '/places:searchText',
          { textQuery: query, maxResultCount: results, ...(isPoint(body.bias) ? { locationBias: circle(body.bias, MAX_RADIUS_M) } : {}) },
          PLACE_FIELDS.map((f) => `places.${f}`).join(','),
        );
        return error ? json({ error }) : json({ places: (data.places ?? []).map(normalise).filter(Boolean) });
      }
      if (url.pathname === '/details') {
        const id = String(body.placeId ?? '');
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: 'invalid_request' }, 400);
        const session = body.sessionToken ? `?sessionToken=${encodeURIComponent(String(body.sessionToken))}` : '';
        const { data, error } = await google(env, `/places/${id}${session}`, null, PLACE_FIELDS.join(','));
        return error ? json({ error }) : json({ place: normalise(data) });
      }
      if (url.pathname === '/autocomplete') {
        const input = String(body.input ?? '').slice(0, 100).trim();
        if (input.length < 2) return json({ suggestions: [] });
        const { data, error } = await google(
          env,
          '/places:autocomplete',
          { input, sessionToken: body.sessionToken, ...(isPoint(body.bias) ? { locationBias: circle(body.bias, MAX_RADIUS_M) } : {}) },
          'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types,suggestions.placePrediction.distanceMeters',
        );
        if (error) return json({ error });
        return json({
          suggestions: (data.suggestions ?? [])
            .map((s) => s.placePrediction)
            .filter(Boolean)
            .map((p) => ({
              providerPlaceId: p.placeId,
              primaryText: p.structuredFormat?.mainText?.text ?? '',
              secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
              types: p.types ?? [],
              distanceMeters: typeof p.distanceMeters === 'number' ? p.distanceMeters : null,
            })),
        });
      }
      return json({ error: 'not_found' }, 404);
    } catch {
      return json({ error: 'unknown' }, 500);
    }
  },
};
