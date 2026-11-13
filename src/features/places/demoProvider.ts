import { PlacesError, type DiscoverRequest, type PlaceDetails, type PlacesProvider } from './provider';

/**
 * Demo places for development and tests only (EXPO_PUBLIC_PLACES_PROVIDER=demo).
 * Names say "Sample"; the UI labels the source "Demo data — not real places".
 * Never used unless that flag is set.
 */
export function demoPlaces(request: Pick<DiscoverRequest, 'category' | 'location' | 'radiusMeters'>): PlaceDetails[] {
  const offsets = [0.3, 0.55, 0.8, 1.6, 3.2];
  return offsets.map((km, i) => {
    const lat = request.location.latitude + (km / 111) * (i % 2 ? 1 : -1);
    const lon = request.location.longitude + (km / 111) * (i % 3 ? 0.5 : -0.5);
    return {
      provider: 'manual',
      providerPlaceId: `demo:${request.category}:${i + 1}`,
      name: `Sample ${request.category} ${i + 1}`,
      location: { latitude: lat, longitude: lon },
      formattedAddress: 'Demo data',
      types: [],
      district: null,
      state: null,
      country: null,
      metadata: { source: 'demo' },
      rating: null,
      userRatingCount: null,
      editorialSummary: 'Demo entry for testing. Not a real place.',
      photos: [],
      mapsUri: null,
      attributions: ['Demo data'],
    };
  });
}

export const demoProvider: PlacesProvider = {
  id: 'manual',
  configured: true,
  source: { kind: 'demo', name: 'Demo data', attribution: 'Demo data — not real places' },
  autocomplete: () => Promise.reject(new PlacesError('not_configured', 'Search is not available with demo data.')),
  details: () => Promise.reject(new PlacesError('not_found')),
  nearby: (r) => Promise.resolve(demoPlaces({ category: 'nearby', location: r.location, radiusMeters: r.radiusMeters })),
  textSearch: () => Promise.resolve([]),
  discover: (r) => Promise.resolve(demoPlaces(r)),
  photoUrl: () => null,
};
