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
  /** Two-letter region to prefer (e.g. "in"); optional. */
  regionCode?: string;
}

export interface NearbyRequest {
  location: GeoPoint;
  radiusMeters: number;
  /** Provider place types to include, e.g. tourist_attraction, park. */
  includedTypes?: readonly string[];
  maxResults?: number;
  /** Most popular first (default) or nearest first. */
  rank?: 'popularity' | 'distance';
}

export interface TextSearchRequest {
  query: string;
  bias?: GeoPoint | null;
  maxResults?: number;
  /** Radius of the bias circle (metres); results outside may still appear and are filtered by the caller. */
  radiusMeters?: number;
  rank?: 'relevance' | 'distance';
  /** Continues an earlier search (providers that page). */
  pageToken?: string | null;
}

/** One page of places; `nextPageToken` is set when the provider has more. */
export interface PlacesPage {
  places: PlaceDetails[];
  nextPageToken: string | null;
}

export interface DiscoverRequest {
  /** OpenStreetMap-style tag selectors for the category (see discovery.ts). */
  selectors: readonly string[];
  /** Category key, for providers that search by their own types. */
  category: string;
  location: GeoPoint;
  radiusMeters: number;
  maxResults?: number;
  /** How the provider should search this category (place types or a text query). */
  search?: { kind: 'nearby'; includedTypes: readonly string[] } | { kind: 'text'; query: string };
  rank?: 'popularity' | 'distance';
  pageToken?: string | null;
}

/** Where a provider's data comes from, shown with every result. Demo data is never presented as live. */
export interface PlacesSource {
  kind: 'live' | 'demo';
  name: string;
  attribution: string;
  /**
   * Whether results may be kept on the device between sessions. Open map data may; Google Places
   * content is only held in memory for the session (its terms allow storing Place IDs and,
   * for at most 30 days, coordinates — not names, ratings or photos).
   */
  storable?: boolean;
}

export interface PlacesProvider {
  readonly id: PlaceProviderId;
  /** False when the app has no provider configured; every call then fails with `not_configured`. */
  readonly configured: boolean;
  readonly source?: PlacesSource;
  /** Places of a category around a point (providers without it use nearby / text search). */
  discover?(request: DiscoverRequest, signal?: AbortSignal): Promise<PlaceDetails[]>;
  /** Like `discover`, one page at a time (providers that support paging). */
  discoverPage?(request: DiscoverRequest, signal?: AbortSignal): Promise<PlacesPage>;
  /** Opens a Maps short link on the server side and returns the final URL (null when it can't). */
  resolveLink?(url: string, signal?: AbortSignal): Promise<string | null>;
  autocomplete(request: AutocompleteRequest, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  /**
   * Full place for an id. `nameHint` is the name the user already saw (the tapped suggestion
   * or the shared name): with it the provider can skip asking for the name, which keeps
   * Google's Place Details in its cheapest (Essentials) tier.
   */
  details(providerPlaceId: string, options: { sessionToken?: string; nameHint?: string }, signal?: AbortSignal): Promise<PlaceDetails>;
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
  /** The places service's own spending limit for Google is reached (free data is used instead). */
  | 'budget_exhausted'
  /** Google is switched off on the places service (or its accounting is unavailable). */
  | 'disabled'
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
  budget_exhausted: 'Enhanced place search has reached its limit for now; free map search is used instead.',
  disabled: 'Enhanced place search is switched off; free map search is used instead.',
  unknown: 'Place search failed. Try again.',
};

export class PlacesError extends Error {
  constructor(
    readonly kind: PlacesErrorKind,
    message: string = MESSAGES[kind],
    /** The service's precise reason (e.g. GOOGLE_BUDGET_EXHAUSTED), for diagnostics. */
    readonly code: string | null = null,
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
