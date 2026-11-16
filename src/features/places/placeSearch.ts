import { useEffect, useState } from 'react';

import type { GeoPoint } from '../planner/model';
import { placesProvider } from './config';
import { isPlacesError, type PlaceDetails, type PlaceSuggestion, type PlacesProvider } from './provider';

/**
 * Search-as-you-type over the active places provider (Google Places through
 * Trip Prep's proxy when configured; open map data otherwise). Requests are debounced, the previous one is
 * cancelled, results are cached for the session, and the provider itself
 * spaces requests to respect the service's usage policy. When an exact
 * search finds nothing, simpler spellings are tried (accents removed,
 * punctuation dropped, then fewer words).
 */
export const MIN_QUERY = 2;
export const DEBOUNCE_MS = 350;
const CACHE_LIMIT = 80;

export function normaliseQuery(query: string): string {
  return query
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The queries to try, most specific first, without repeats. */
export function queryVariants(query: string): string[] {
  const raw = query.replace(/\s+/g, ' ').trim();
  const plain = normaliseQuery(raw);
  const words = plain.split(' ').filter(Boolean);
  const out = [raw, plain];
  // Drop filler words people add ("near", "the", "in Kerala" stays as context).
  const trimmed = words.filter((w) => !/^(near|the|at|of|in)$/i.test(w));
  out.push(trimmed.join(' '));
  if (trimmed.length > 2) out.push(trimmed.slice(0, 2).join(' '));
  if (trimmed.length > 1) out.push(trimmed[0] ?? '');
  return [...new Set(out.map((q) => q.trim()).filter((q) => q.length >= MIN_QUERY))];
}

const cache = new Map<string, PlaceDetails[]>();
const keyFor = (q: string, bias: GeoPoint | null | undefined) =>
  `${q.toLowerCase()}|${bias ? `${bias.latitude.toFixed(1)},${bias.longitude.toFixed(1)}` : ''}`;

export function clearPlaceSearchCache() {
  cache.clear();
}

export async function searchPlaces(
  query: string,
  options: { bias?: GeoPoint | null; signal?: AbortSignal; provider?: Pick<PlacesProvider, 'textSearch'>; limit?: number } = {},
): Promise<{ places: PlaceDetails[]; usedQuery: string | null }> {
  const provider = options.provider ?? placesProvider;
  for (const q of queryVariants(query)) {
    const key = keyFor(q, options.bias);
    let places = cache.get(key);
    if (!places) {
      places = await provider.textSearch({ query: q, bias: options.bias ?? null, maxResults: options.limit ?? 8 }, options.signal);
      cache.set(key, places);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    }
    if (places.length) return { places, usedQuery: q };
  }
  return { places: [], usedQuery: null };
}

/* ------------------------------------------------------------------ */
/* Autocomplete: suggestions while typing, details only when picked     */
/* ------------------------------------------------------------------ */

/**
 * A search session: the autocomplete calls made while typing and the single
 * details call after a pick share one token, which is how Google bills them as
 * one session. A new token starts after each pick.
 */
export function createSessionToken(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

const suggestionCache = new Map<string, PlaceSuggestion[]>();

export function clearSuggestionCache() {
  suggestionCache.clear();
}

/** Suggestions for what the user typed; simpler spellings are tried only when the exact text finds nothing. */
export async function searchSuggestions(
  query: string,
  options: { sessionToken: string; bias?: GeoPoint | null; signal?: AbortSignal; provider?: Pick<PlacesProvider, 'autocomplete'> },
): Promise<{ suggestions: PlaceSuggestion[]; usedQuery: string | null }> {
  const provider = options.provider ?? placesProvider;
  for (const q of queryVariants(query)) {
    const key = keyFor(q, options.bias);
    let found = suggestionCache.get(key);
    if (!found) {
      found = await provider.autocomplete({ input: q, sessionToken: options.sessionToken, bias: options.bias ?? null }, options.signal);
      suggestionCache.set(key, found);
      if (suggestionCache.size > CACHE_LIMIT) suggestionCache.delete(suggestionCache.keys().next().value as string);
    }
    if (found.length) return { suggestions: found, usedQuery: q };
  }
  return { suggestions: [], usedQuery: null };
}

/** The full place for a picked suggestion (name, address, coordinates, Place ID). Never invents coordinates. */
export async function resolveSuggestion(
  suggestion: PlaceSuggestion,
  options: { sessionToken: string; signal?: AbortSignal; provider?: Pick<PlacesProvider, 'details'> },
): Promise<PlaceDetails> {
  const provider = options.provider ?? placesProvider;
  const place = await provider.details(suggestion.providerPlaceId, { sessionToken: options.sessionToken }, options.signal);
  return { ...place, name: place.name || suggestion.primaryText, providerPlaceId: place.providerPlaceId || suggestion.providerPlaceId };
}

export function describeSearchError(error: unknown): string {
  const kind = isPlacesError(error) ? error.kind : 'unknown';
  switch (kind) {
    case 'offline':
    case 'network':
      return 'You’re offline or the connection dropped. Place search needs a connection.';
    case 'quota':
      return 'Place search is busy or over its daily limit. Try again in a little while.';
    case 'denied':
    case 'not_configured':
      return 'Place search isn’t available in this build right now.';
    case 'not_found':
      return 'That place couldn’t be loaded.';
    default:
      return 'Place search failed. Try again.';
  }
}

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; suggestions: PlaceSuggestion[]; usedQuery: string | null }
  | { status: 'error'; message: string };

/** Debounced autocomplete for a text field; cancels the previous request when the text changes. */
export function usePlaceAutocomplete(query: string, bias: GeoPoint | null | undefined, enabled: boolean, sessionToken: string): SearchState {
  const q = query.trim();
  const active = enabled && q.length >= MIN_QUERY && placesProvider.configured;
  const biasKey = bias ? `${bias.latitude.toFixed(3)},${bias.longitude.toFixed(3)}` : '';
  const key = `${q}|${biasKey}`;
  const [result, setResult] = useState<{ key: string; state: SearchState } | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const [lat, lng] = biasKey ? biasKey.split(',').map(Number) : [];
    const near = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : null;
    const timer = setTimeout(() => {
      searchSuggestions(q, { bias: near, signal: controller.signal, sessionToken })
        .then((r) => !controller.signal.aborted && setResult({ key, state: { status: 'ready', ...r } }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResult({ key, state: { status: 'error', message: describeSearchError(err) } });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, q, biasKey, key, sessionToken]);
  if (!active) return { status: 'idle' };
  return result?.key === key ? result.state : { status: 'loading' };
}
