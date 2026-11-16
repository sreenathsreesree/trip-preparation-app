import { demoProvider } from './demoProvider';
import { createOsmProvider } from './osmProvider';
import { createProxyProvider } from './proxyProvider';
import { isPlacesError, unconfiguredProvider, type PlaceDetails, type PlacesErrorKind, type PlacesProvider } from './provider';

/**
 * The app's active place provider, chosen at build time:
 *
 * 1. Google Places via Trip Prep's places proxy, only if
 *    `EXPO_PUBLIC_PLACES_PROXY_URL` (an https URL, not a secret) is set. That
 *    needs a Google Cloud project with Places API (New) **and billing**, so it
 *    is off: the Google key would live only in the proxy, never in the app.
 * 2. Otherwise OpenStreetMap (default): live, free, keyless, no billing.
 * 3. `EXPO_PUBLIC_PLACES_PROVIDER=demo`: labelled demo data for development;
 *    `=off`: no place search at all.
 */
export function placesProxyUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

export type PlacesProviderChoice = 'google-proxy' | 'osm' | 'demo' | 'off';

export function choosePlacesProvider(env: { proxyUrl?: string; provider?: string }): PlacesProviderChoice {
  const flag = env.provider?.trim().toLowerCase();
  if (flag === 'off') return 'off';
  if (flag === 'demo') return 'demo';
  if (placesProxyUrl(env.proxyUrl)) return 'google-proxy';
  return 'osm';
}

/**
 * Which Google endpoints the app uses (initial, budget-controlled rollout). Nearby Search,
 * Text Search and Photos stay on free map data; the places service refuses them anyway.
 */
export const GOOGLE_ENDPOINTS = { autocomplete: true, details: true, nearby: false, textSearch: false, photos: false } as const;

/** How long Google is skipped after the places service says no (no retry loops). */
export const COOLDOWN_MS: Partial<Record<PlacesErrorKind, number>> = {
  budget_exhausted: 6 * 60 * 60 * 1000,
  disabled: 6 * 60 * 60 * 1000,
  not_configured: 6 * 60 * 60 * 1000,
  quota: 30 * 60 * 1000,
  network: 2 * 60 * 1000,
};

export interface PlacesDiagnostics {
  /** Which provider answers searches now. */
  active: 'google' | 'free';
  /** Why Google is skipped (error kind and the service's code, e.g. GOOGLE_BUDGET_EXHAUSTED). */
  reason: { kind: PlacesErrorKind; code: string | null; at: string; until: string } | null;
}

/**
 * Google first (Autocomplete and Place Details only); free open map data for everything else,
 * and also whenever the places service is not set up, switched off, over its budget or down.
 * After such an answer Google is skipped for a while, so nothing retries in a loop. Each place
 * id is answered by the provider that issued it.
 */
export function withFallback(primary: PlacesProvider, fallback: PlacesProvider, now: () => number = Date.now) {
  const isFallbackId = (id: string) => /^(?:osm|pin|demo):/.test(id);
  let skip: PlacesDiagnostics['reason'] = null;
  const skipping = () => skip !== null && Date.parse(skip.until) > now();
  const details = new Map<string, { at: number; value: Promise<PlaceDetails> }>();
  const DETAILS_MS = 10 * 60 * 1000;

  async function run<T>(a: () => Promise<T>, b: () => Promise<T>): Promise<T> {
    if (skipping()) return b();
    try {
      return await a();
    } catch (error) {
      const kind = isPlacesError(error) ? error.kind : null;
      const cooldown = kind ? COOLDOWN_MS[kind] : undefined;
      if (!kind || cooldown === undefined || !fallback.configured) throw error;
      const t = now();
      skip = { kind, code: isPlacesError(error) ? error.code : null, at: new Date(t).toISOString(), until: new Date(t + cooldown).toISOString() };
      return b();
    }
  }
  const viaFallback = <T,>(f: () => Promise<T>) => f();

  const provider: PlacesProvider & { diagnostics: () => PlacesDiagnostics } = {
    id: primary.id,
    configured: true,
    get source() {
      // Lists (recommendations) come from free data in this rollout, so they carry its source and caching rules.
      return GOOGLE_ENDPOINTS.nearby && !skipping() ? primary.source : fallback.source;
    },
    autocomplete: (r, s) => run(() => primary.autocomplete(r, s), () => fallback.autocomplete(r, s)),
    details: (id, o, s) => {
      if (isFallbackId(id)) return fallback.details(id, o, s);
      // The same pick within a few minutes reuses the answer (no second paid call).
      const held = details.get(id);
      if (held && now() - held.at < DETAILS_MS) return held.value;
      const value = run(() => primary.details(id, o, s), () => fallback.details(id, o, s));
      details.set(id, { at: now(), value });
      value.catch(() => details.delete(id));
      return value;
    },
    nearby: (r, s) => (GOOGLE_ENDPOINTS.nearby ? run(() => primary.nearby(r, s), () => fallback.nearby(r, s)) : viaFallback(() => fallback.nearby(r, s))),
    textSearch: (r, s) => (GOOGLE_ENDPOINTS.textSearch ? run(() => primary.textSearch(r, s), () => fallback.textSearch(r, s)) : viaFallback(() => fallback.textSearch(r, s))),
    discover: fallback.discover ? (r, s) => fallback.discover!(r, s) : undefined,
    resolveLink: primary.resolveLink ? (url, s) => primary.resolveLink!(url, s).catch(() => null) : undefined,
    photoUrl: (photo, w) => (GOOGLE_ENDPOINTS.photos ? primary.photoUrl(photo, w) : null),
    diagnostics: () => ({ active: skipping() ? 'free' : 'google', reason: skipping() ? skip : null }),
  };
  return provider;
}

/** Place search status for diagnostics (null when Google isn't part of this build). */
export function placesDiagnostics(): PlacesDiagnostics | null {
  const p = placesProvider as PlacesProvider & { diagnostics?: () => PlacesDiagnostics };
  return p.diagnostics ? p.diagnostics() : null;
}

const proxyUrl = placesProxyUrl(process.env.EXPO_PUBLIC_PLACES_PROXY_URL);
const choice = choosePlacesProvider({ proxyUrl: process.env.EXPO_PUBLIC_PLACES_PROXY_URL, provider: process.env.EXPO_PUBLIC_PLACES_PROVIDER });

export const placesProvider: PlacesProvider =
  choice === 'google-proxy' && proxyUrl ? withFallback(createProxyProvider(proxyUrl), createOsmProvider()) : choice === 'osm' ? createOsmProvider() : choice === 'demo' ? demoProvider : unconfiguredProvider;
