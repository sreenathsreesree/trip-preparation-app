import { useEffect, useState } from 'react';

import type { GeoPoint } from '../planner/model';
import { placesProvider } from './config';
import { isPlacesError, type PlaceDetails, type PlacesProvider } from './provider';

/**
 * Search-as-you-type over the active places provider (OpenStreetMap by
 * default — free, keyless). Requests are debounced, the previous one is
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

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; places: PlaceDetails[]; usedQuery: string | null }
  | { status: 'error'; message: string };

/** Debounced autocomplete for a text field. */
export function usePlaceAutocomplete(query: string, bias?: GeoPoint | null, enabled = true): SearchState {
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
      searchPlaces(q, { bias: near, signal: controller.signal })
        .then((r) => !controller.signal.aborted && setResult({ key, state: { status: 'ready', ...r } }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const kind = isPlacesError(err) ? err.kind : 'unknown';
          const message =
            kind === 'offline'
              ? 'You’re offline. Place search needs a connection.'
              : kind === 'quota'
                ? 'The free map search is busy. Wait a moment and keep typing.'
                : 'Place search failed. Try again.';
          setResult({ key, state: { status: 'error', message } });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, q, biasKey, key]);
  if (!active) return { status: 'idle' };
  return result?.key === key ? result.state : { status: 'loading' };
}
