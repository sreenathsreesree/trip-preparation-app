// Trip Prep places proxy — NOT deployed.
//
// Holds the Google Places API key as a secret so the app never ships it, and puts
// every paid Google request through the budget controller (budget.mjs): the
// request is classified into a billing SKU from its endpoint and field mask,
// priced from server configuration, and reserved against the monthly INR
// allowance BEFORE Google is called. Anything that cannot be classified, priced
// or recorded is refused, and the app falls back to free map data.
//
// Initial rollout: Google Autocomplete and Place Details only. Nearby Search,
// Text Search and Photos stay off for Google (recommendations use free data).
// Short-link resolution never calls a Google API and costs nothing.
//
// See README.md (Stage A/B/C). Deploying this, and any billing, needs the owner's approval.

import { budgetClient, classifyRequest, costInr, dailyLimitKey, loadConfig } from './budget.mjs';

export { PlacesBudget } from './budget.mjs';

const GOOGLE = 'https://places.googleapis.com/v1';
const MAX_RADIUS_M = 50_000;

// Place Details for a picked suggestion: Essentials-tier fields only. The name comes
// from the suggestion the user tapped (`nameHint`); only without one is `displayName`
// (Pro tier) requested, and then billed and accounted as Pro.
export const DETAILS_FIELDS = ['id', 'formattedAddress', 'location', 'types', 'addressComponents', 'plusCode', 'shortFormattedAddress'];


// Short share links the proxy may open (never arbitrary URLs: no open redirect / SSRF).
const SHORT_LINK = /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\/[A-Za-z0-9_\-/?=&.%]+$/;
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)*(?:google\.[a-z.]+|goo\.gl|g\.co|app\.goo\.gl)$/i;

const component = (place, type) => (place.addressComponents ?? []).find((c) => Array.isArray(c.types) && c.types.includes(type))?.longText ?? null;

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
    district: component(place, 'administrative_area_level_2') ?? component(place, 'administrative_area_level_3'),
    state: component(place, 'administrative_area_level_1'),
    country: component(place, 'country'),
    metadata: {
      ...(typeof place.currentOpeningHours?.openNow === 'boolean' ? { openNow: place.currentOpeningHours.openNow } : {}),
      ...(component(place, 'locality') || component(place, 'sublocality') ? { locality: component(place, 'locality') ?? component(place, 'sublocality') } : {}),
      ...(place.plusCode?.globalCode ? { plusCode: place.plusCode.globalCode } : {}),
      ...(place.shortFormattedAddress ? { shortAddress: place.shortFormattedAddress } : {}),
    },
    attributions: ['Google Maps'],
  };
}

const circle = (point, radius) => ({ circle: { center: { latitude: Number(point.latitude), longitude: Number(point.longitude) }, radius } });
const isPoint = (p) => p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude));

/** Structured log line: no API key, no search text, no user data. */
const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

const ENABLED_DEFAULT = ['autocomplete', 'details'];
const enabledEndpoints = (env) =>
  typeof env.GOOGLE_ENDPOINTS === 'string' && env.GOOGLE_ENDPOINTS.trim() ? env.GOOGLE_ENDPOINTS.split(',').map((e) => e.trim()) : ENABLED_DEFAULT;

/** Refusal the app understands: `error` is the kind, `code` the precise reason. */
const refuse = (kind, code) => ({ error: kind, code });

/**
 * The only way to call Google: switch → key → configuration → SKU → atomic reservation
 * → request → outcome. Every failure before the request refuses it (fail closed).
 */
async function google(env, { endpoint, path, body, mask }) {
  if (env.GOOGLE_PLACES_ENABLED !== 'true') return refuse('disabled', 'GOOGLE_DISABLED');
  if (!enabledEndpoints(env).includes(endpoint)) return refuse('disabled', 'GOOGLE_ENDPOINT_DISABLED');
  if (!env.GOOGLE_PLACES_KEY) return refuse('not_configured', 'GOOGLE_NOT_CONFIGURED');
  const loaded = loadConfig(env);
  if (!loaded.ok) {
    log('budget_config_invalid', { endpoint, reason: loaded.reason });
    return refuse('disabled', 'GOOGLE_BUDGET_CONFIG_INVALID');
  }
  const config = loaded.config;
  const ledger = budgetClient(env);
  if (!ledger) return refuse('disabled', 'GOOGLE_BUDGET_UNAVAILABLE');
  const sku = classifyRequest(endpoint, mask);
  if (!sku) {
    await ledger.block('GOOGLE_SKU_UNKNOWN', config.timeZone).catch(() => undefined);
    log('sku_unknown', { endpoint });
    return refuse('disabled', 'GOOGLE_SKU_UNKNOWN');
  }
  const cost = costInr(sku, config);
  if (cost === null) return refuse('disabled', 'GOOGLE_BUDGET_CONFIG_INVALID');
  let reservation;
  try {
    reservation = await ledger.reserve({ sku, costInr: cost, allowanceInr: config.allowanceInr, dailyLimit: config.dailyLimits[dailyLimitKey(sku)], timeZone: config.timeZone });
  } catch {
    log('budget_unavailable', { endpoint, sku });
    return refuse('disabled', 'GOOGLE_BUDGET_UNAVAILABLE');
  }
  if (!reservation?.ok) {
    log('budget_block', { endpoint, sku, code: reservation?.code ?? 'unknown', month: reservation?.month, estimatedInr: reservation?.totalInr });
    if (reservation?.code === 'GOOGLE_DAILY_LIMIT') return refuse('budget_exhausted', 'GOOGLE_DAILY_LIMIT');
    if (reservation?.code === 'GOOGLE_BUDGET_EXHAUSTED') return refuse('budget_exhausted', 'GOOGLE_BUDGET_EXHAUSTED');
    return refuse('disabled', 'GOOGLE_BUDGET_UNAVAILABLE');
  }
  let response;
  try {
    response = await fetch(`${GOOGLE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': mask },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    response = null;
  }
  const ok = Boolean(response?.ok);
  // The reservation stands either way: a failed request is never refunded.
  await ledger.record({ month: reservation.month, ok }).catch(() => log('record_failed', { endpoint, sku }));
  log('google_request', { endpoint, sku, ok, status: response?.status ?? 0, month: reservation.month, estimatedInr: reservation.totalInr });
  if (!response) return { error: 'network' };
  if (!response.ok) return { error: errorKind(response.status) };
  return { data: await response.json() };
}

/** Constant-time comparison for the admin token. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function adminUsage(request, env) {
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!env.ADMIN_TOKEN || !sameSecret(token, env.ADMIN_TOKEN)) return json({ error: 'denied' }, 401);
  const loaded = loadConfig(env);
  const ledger = budgetClient(env);
  const base = {
    googleEnabled: env.GOOGLE_PLACES_ENABLED === 'true',
    keyConfigured: Boolean(env.GOOGLE_PLACES_KEY),
    endpoints: enabledEndpoints(env),
    configValid: loaded.ok,
    ...(loaded.ok ? {} : { configProblem: loaded.reason }),
    ...(loaded.ok
      ? { pricing: { priceList: loaded.config.priceList, verifiedOn: loaded.config.verifiedOn, source: loaded.config.source, usdToInr: loaded.config.usdToInr, fxBufferPct: loaded.config.fxBufferPct, taxPct: loaded.config.taxPct, usdPer1000: loaded.config.usdPer1000 } }
      : {}),
  };
  if (!loaded.ok || !ledger) return json({ ...base, ledgerAvailable: Boolean(ledger) });
  try {
    const status = await ledger.status({ allowanceInr: loaded.config.allowanceInr, reserveInr: loaded.config.reserveInr, totalInr: loaded.config.totalInr, timeZone: loaded.config.timeZone, dailyLimits: loaded.config.dailyLimits });
    return json({ ...base, ledgerAvailable: true, ...status });
  } catch {
    return json({ ...base, ledgerAvailable: false });
  }
}

/**
 * Follows a Google Maps short link hop by hop (at most 6), only through Google
 * hosts, and returns the final Maps URL. No API key is used for this.
 */
export async function followShortLink(link, fetchImpl = fetch) {
  let current = link;
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: { Accept: 'text/html' } });
    const location = response.headers.get('Location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !GOOGLE_HOST.test(next.hostname)) return null;
      current = next.toString();
      if (/\/maps(?:\/|\?|$)|[?&](?:q|query|ftid|cid)=/.test(next.pathname + next.search) && !/^(?:maps\.app\.)?goo\.gl$/i.test(next.hostname)) return current;
      continue;
    }
    if (response.ok) {
      const html = await response.text();
      const found = /https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"'\s<>]+/i.exec(html);
      return found ? found[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&') : current === link ? null : current;
    }
    return null;
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/admin/usage') return adminUsage(request, env);
      // Not a Google API call (no key, no cost): opening a Maps short link.
      if (request.method === 'POST' && url.pathname === '/resolve-link') {
        const body = await request.json().catch(() => ({}));
        const link = String(body.url ?? '').trim();
        if (!SHORT_LINK.test(link)) return json({ error: 'invalid_request' }, 400);
        const resolved = await followShortLink(link);
        return resolved ? json({ url: resolved }) : json({ error: 'not_found' });
      }
      if (url.pathname === '/photo' || url.pathname === '/nearby' || url.pathname === '/text') {
        // Disabled for Google in this rollout: never priced, never called.
        return json(refuse('disabled', 'GOOGLE_ENDPOINT_DISABLED'), 503);
      }
      if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405);
      const body = await request.json().catch(() => ({}));
      const send = (result, ok) => (result.code ? json(result, 503) : result.error ? json({ error: result.error }, result.error === 'not_found' ? 404 : 502) : ok(result.data));

      if (url.pathname === '/details') {
        const id = String(body.placeId ?? '');
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: 'invalid_request' }, 400);
        const nameHint = typeof body.nameHint === 'string' ? body.nameHint.trim().slice(0, 120) : '';
        const session = typeof body.sessionToken === 'string' && body.sessionToken ? `?sessionToken=${encodeURIComponent(body.sessionToken.slice(0, 100))}` : '';
        const mask = (nameHint ? DETAILS_FIELDS : [...DETAILS_FIELDS, 'displayName']).join(',');
        return send(await google(env, { endpoint: 'details', path: `/places/${id}${session}`, body: null, mask }), (data) => {
          const place = normalise(data);
          if (!place) return json({ error: 'not_found' }, 404);
          return json({ place: { ...place, name: place.name || nameHint } });
        });
      }
      if (url.pathname === '/autocomplete') {
        const input = String(body.input ?? '').slice(0, 100).trim();
        if (input.length < 2) return json({ suggestions: [] });
        // A session token is required so typing and the final details call are billed as one session.
        const token = typeof body.sessionToken === 'string' && /^[A-Za-z0-9_-]{8,36}$/.test(body.sessionToken) ? body.sessionToken : null;
        if (!token) return json({ error: 'invalid_request' }, 400);
        const region = typeof body.regionCode === 'string' && /^[a-z]{2}$/i.test(body.regionCode) ? body.regionCode.toLowerCase() : undefined;
        const result = await google(env, {
          endpoint: 'autocomplete',
          path: '/places:autocomplete',
          body: {
            input,
            sessionToken: token,
            ...(isPoint(body.bias) ? { locationBias: circle(body.bias, MAX_RADIUS_M), origin: { latitude: Number(body.bias.latitude), longitude: Number(body.bias.longitude) } } : {}),
            ...(region ? { regionCode: region } : {}),
          },
          mask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types,suggestions.placePrediction.distanceMeters',
        });
        return send(result, (data) =>
          json({
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
          }),
        );
      }
      return json({ error: 'not_found' }, 404);
    } catch {
      return json({ error: 'unknown' }, 500);
    }
  },
};
