import type { PlaceDetails } from './provider';

/** What is kept when a found place is added: identity, location and provider metadata (no ratings or photos). */
export function toPlaceInput(place: PlaceDetails) {
  return {
    provider: place.provider,
    metadata: place.metadata,
    providerPlaceId: place.providerPlaceId,
    name: place.name,
    location: place.location,
    formattedAddress: place.formattedAddress,
    types: place.types,
    district: place.district,
    state: place.state,
    country: place.country,
  };
}
