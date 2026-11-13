import { demoProvider } from './demoProvider';
import { createOsmProvider } from './osmProvider';
import { createProxyProvider } from './proxyProvider';
import { unconfiguredProvider, type PlacesProvider } from './provider';

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

const proxyUrl = placesProxyUrl(process.env.EXPO_PUBLIC_PLACES_PROXY_URL);
const choice = choosePlacesProvider({ proxyUrl: process.env.EXPO_PUBLIC_PLACES_PROXY_URL, provider: process.env.EXPO_PUBLIC_PLACES_PROVIDER });

export const placesProvider: PlacesProvider =
  choice === 'google-proxy' && proxyUrl ? createProxyProvider(proxyUrl) : choice === 'osm' ? createOsmProvider() : choice === 'demo' ? demoProvider : unconfiguredProvider;
