import { createProxyProvider } from './proxyProvider';
import { unconfiguredProvider, type PlacesProvider } from './provider';

/**
 * The app's active place provider.
 *
 * Live Google Places data needs Trip Prep's places proxy (server/places-proxy),
 * which holds the Google key and needs a Google Cloud project with
 * Places API (New) **and billing linked**. Until `EXPO_PUBLIC_PLACES_PROXY_URL`
 * (an https URL, not a secret) is set, search and recommendations honestly
 * report "not set up" and the planner works with places entered by name.
 * No provider key ever lives in the app, and no sample data is substituted.
 */
export function placesProxyUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

const proxyUrl = placesProxyUrl(process.env.EXPO_PUBLIC_PLACES_PROXY_URL);

export const placesProvider: PlacesProvider = proxyUrl ? createProxyProvider(proxyUrl) : unconfiguredProvider;
