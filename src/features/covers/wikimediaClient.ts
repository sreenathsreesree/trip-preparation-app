import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { CoverLookupError } from './coverErrors';

/**
 * Wikimedia (Wikipedia API, Commons API and upload.wikimedia.org) refuses
 * requests that carry a generic library User-Agent such as Android's
 * `okhttp/x` (HTTP 403, "Please set a user-agent", Wikimedia task T400119),
 * and rate-limits busy clients (HTTP 429). Browsers send their own
 * User-Agent, so the web build worked while the Android app got nothing.
 * Every request from the app therefore identifies itself, as Wikimedia's
 * User-Agent policy asks.
 */
export const APP_USER_AGENT = `TripPrep/${Constants.expoConfig?.version ?? '0'} (${Platform.OS}; https://github.com/sreenathsreesree/trip-preparation-app)`;

/** Headers for Wikimedia requests. Browsers forbid setting User-Agent, so on web only the API's own header is sent. */
export function wikimediaHeaders(extra: Record<string, string> = {}): Record<string, string> {
  if (Platform.OS === 'web') return extra;
  return { 'User-Agent': APP_USER_AGENT, 'Api-User-Agent': APP_USER_AGENT, ...extra };
}

/** An image source for expo-image that downloads with the same identification (native only). */
export function imageSource(uri: string): { uri: string; headers?: Record<string, string> } {
  if (Platform.OS === 'web' || !/^https:\/\/upload\.wikimedia\.org\//.test(uri)) return { uri };
  return { uri, headers: { 'User-Agent': APP_USER_AGENT } };
}

/** fetch for Wikimedia: identified, and with HTTP errors turned into CoverLookupError. */
export function wikimediaFetch(fetchImpl: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    let res: Response;
    try {
      res = await fetchImpl(input, { ...init, headers: wikimediaHeaders((init?.headers as Record<string, string>) ?? {}) });
    } catch {
      throw new CoverLookupError('No connection to the photo service.', null);
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      throw new CoverLookupError(res.status === 429 ? 'The photo service is busy.' : `The photo service refused the request (${res.status}).`, res.status);
    }
    return res;
  }) as typeof fetch;
}
