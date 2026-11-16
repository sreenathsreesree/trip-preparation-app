import { demoProvider } from './demoProvider';
import { createOsmProvider } from './osmProvider';
import { createProxyProvider } from './proxyProvider';
import { isPlacesError, PlacesError, unconfiguredProvider, type PlacesProvider } from './provider';

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
 * Google first; the free open-data provider only while the Google proxy says it is not set up
 * (no key on the server yet). Quota, network and refusal errors are reported, not hidden by a
 * silent switch to other data. Each place id is answered by the provider that issued it.
 */
export function withFallback(primary: PlacesProvider, fallback: PlacesProvider): PlacesProvider {
  const isFallbackId = (id: string) => /^(?:osm|pin|demo):/.test(id);
  async function run<T>(a: () => Promise<T>, b: () => Promise<T>): Promise<T> {
    try {
      return await a();
    } catch (error) {
      if (isPlacesError(error) && error.kind === 'not_configured' && fallback.configured) return b();
      throw error;
    }
  }
  return {
    id: primary.id,
    configured: true,
    get source() {
      return primary.source;
    },
    autocomplete: (r, s) => run(() => primary.autocomplete(r, s), () => fallback.autocomplete(r, s)),
    details: (id, o, s) => (isFallbackId(id) ? fallback.details(id, o, s) : run(() => primary.details(id, o, s), () => fallback.details(id, o, s))),
    nearby: (r, s) => run(() => primary.nearby(r, s), () => fallback.nearby(r, s)),
    textSearch: (r, s) => run(() => primary.textSearch(r, s), () => fallback.textSearch(r, s)),
    discoverPage: async (r, s) =>
      run(
        () => (primary.discoverPage ? primary.discoverPage(r, s) : Promise.reject(new PlacesError('not_configured'))),
        async () => ({ places: fallback.discover ? await fallback.discover(r, s) : await fallback.nearby({ location: r.location, radiusMeters: r.radiusMeters, maxResults: r.maxResults }, s), nextPageToken: null }),
      ),
    resolveLink: primary.resolveLink ? (url, s) => primary.resolveLink!(url, s) : undefined,
    photoUrl: (photo, w) => primary.photoUrl(photo, w),
  };
}

const proxyUrl = placesProxyUrl(process.env.EXPO_PUBLIC_PLACES_PROXY_URL);
const choice = choosePlacesProvider({ proxyUrl: process.env.EXPO_PUBLIC_PLACES_PROXY_URL, provider: process.env.EXPO_PUBLIC_PLACES_PROVIDER });

export const placesProvider: PlacesProvider =
  choice === 'google-proxy' && proxyUrl ? withFallback(createProxyProvider(proxyUrl), createOsmProvider()) : choice === 'osm' ? createOsmProvider() : choice === 'demo' ? demoProvider : unconfiguredProvider;
