import type { GeoPoint, PlaceInput, PlaceProviderId } from '../planner/model';

/**
 * Provider-independent place search. Screens and stores depend on this
 * interface only; the Google implementation (via the app's own proxy) is one
 * provider, and tests use fakes. No provider credentials live in the app.
 */

/** One autocomplete prediction. Details are fetched only after the user picks one. */
export interface PlaceSuggestion {
  providerPlaceId: string;
  primaryText: string;
  secondaryText: string;
  types: string[];
  distanceMeters: number | null;
}

export interface PlacePhotoRef {
  /** Provider photo resource name; turned into an image URL by the provider. */
  name: string;
  widthPx: number;
  heightPx: number;
  /** Photographer attributions that must be shown with the photo. */
  authorAttributions: { displayName: string; uri: string | null }[];
}

/** Full place information returned by a provider (never fabricated). */
export interface PlaceDetails extends PlaceInput {
  providerPlaceId: string;
  rating: number | null;
  userRatingCount: number | null;
  editorialSummary: string | null;
  photos: PlacePhotoRef[];
  /** Link to the place on the provider's map (e.g. Google Maps). */
  mapsUri: string | null;
  /** Text attributions the provider requires alongside its content. */
  attributions: string[];
}

export interface AutocompleteRequest {
  input: string;
  /** Groups autocomplete calls with the following details call (billing). */
  sessionToken: string;
  /** Bias results towards this point (e.g. the destination being planned). */
  bias?: GeoPoint | null;
}

export interface NearbyRequest {
  location: GeoPoint;
  radiusMeters: number;
  /** Provider place types to include, e.g. tourist_attraction, park. */
  includedTypes?: readonly string[];
  maxResults?: number;
}

export interface TextSearchRequest {
  query: string;
  bias?: GeoPoint | null;
  maxResults?: number;
}

export interface PlacesProvider {
  readonly id: PlaceProviderId;
  /** False when the app has no provider configured; every call then fails with `not_configured`. */
  readonly configured: boolean;
  autocomplete(request: AutocompleteRequest, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  details(providerPlaceId: string, options: { sessionToken?: string }, signal?: AbortSignal): Promise<PlaceDetails>;
  nearby(request: NearbyRequest, signal?: AbortSignal): Promise<PlaceDetails[]>;
  textSearch(request: TextSearchRequest, signal?: AbortSignal): Promise<PlaceDetails[]>;
  /** Image URL for a provider photo (loaded live, never stored), or null when photos are unavailable. */
  photoUrl(photo: PlacePhotoRef, maxWidthPx: number): string | null;
}

export type PlacesErrorKind =
  | 'not_configured'
  | 'offline'
  | 'network'
  | 'quota'
  | 'denied'
  | 'not_found'
  | 'invalid_request'
  | 'cancelled'
  | 'unknown';

const MESSAGES: Record<PlacesErrorKind, string> = {
  not_configured: 'Place search is not set up in this build. You can still add places by name.',
  offline: 'You are offline. Saved places still work; search needs a connection.',
  network: 'Could not reach the place search service. Try again.',
  quota: 'Place search is busy or over its daily limit. Try again later.',
  denied: 'Place search was refused by the service.',
  not_found: 'That place could not be found.',
  invalid_request: 'That search could not be processed.',
  cancelled: 'Search cancelled.',
  unknown: 'Place search failed. Try again.',
};

export class PlacesError extends Error {
  constructor(
    readonly kind: PlacesErrorKind,
    message: string = MESSAGES[kind],
  ) {
    super(message);
    this.name = 'PlacesError';
  }
}

export const isPlacesError = (error: unknown): error is PlacesError => error instanceof PlacesError;

/** Used when no provider is configured: honest failures, never sample data. */
export const unconfiguredProvider: PlacesProvider = {
  id: 'google',
  configured: false,
  autocomplete: () => Promise.reject(new PlacesError('not_configured')),
  details: () => Promise.reject(new PlacesError('not_configured')),
  nearby: () => Promise.reject(new PlacesError('not_configured')),
  textSearch: () => Promise.reject(new PlacesError('not_configured')),
  photoUrl: () => null,
};
