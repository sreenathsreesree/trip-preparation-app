import { diffInDays, isValidISODate, type ISODate } from '@/lib/dates';

import {
  isTransportMode,
  isTravellerKind,
  isTripCategory,
  type Trip,
  type TripInput,
  type TravellerKind,
} from './model';

export const TRIP_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  destinationMin: 2,
  destinationMax: 80,
  destinationsMax: 10,
  maxDurationDays: 365,
  travellersMin: 1,
  travellersMax: 20,
  travellerNameMax: 40,
} as const;

/** A destination row in the form. `key` is a stable UI key; `id` is set for saved rows. */
export interface DraftDestination {
  key: string;
  id?: string;
  name: string;
}

export interface DraftTraveller {
  key: string;
  id?: string;
  name: string;
  kind: TravellerKind;
}

/** Editable state of the trip form; every field may be incomplete. */
export interface TripDraft {
  name: string;
  destinations: DraftDestination[];
  startDate: ISODate | null;
  endDate: ISODate | null;
  travellers: DraftTraveller[];
  transportMode: string | null;
  category: string | null;
}

export type TripDraftField =
  | 'name'
  | 'destinations'
  | 'category'
  | 'startDate'
  | 'endDate'
  | 'travellers'
  | 'transportMode';

export interface TripDraftErrors extends Partial<Record<TripDraftField, string>> {
  /** Per-row errors keyed by `DraftDestination.key`. */
  destinationItems?: Record<string, string>;
  /** Per-row errors keyed by `DraftTraveller.key`. */
  travellerItems?: Record<string, string>;
}

export interface ValidationOptions {
  /** Earliest allowed start: today when creating; when editing, the earlier of today and the saved start. */
  minStartDate: ISODate;
}

function lengthError(value: string, min: number, max: number, emptyMessage: string) {
  if (value.length === 0) return emptyMessage;
  if (value.length < min) return `Use at least ${min} characters.`;
  if (value.length > max) return `Keep it under ${max} characters.`;
  return undefined;
}

export function validateTripDraft(draft: TripDraft, options: ValidationOptions): TripDraftErrors {
  const errors: TripDraftErrors = {};

  const nameError = lengthError(
    draft.name.trim(),
    TRIP_LIMITS.nameMin,
    TRIP_LIMITS.nameMax,
    'Give your trip a name.',
  );
  if (nameError) errors.name = nameError;

  // Destinations: at least one, every row filled in.
  const destinationItems: Record<string, string> = {};
  for (const destination of draft.destinations) {
    const error = lengthError(
      destination.name.trim(),
      TRIP_LIMITS.destinationMin,
      TRIP_LIMITS.destinationMax,
      draft.destinations.length > 1 ? 'Enter a place or remove this stop.' : 'Where are you headed?',
    );
    if (error) destinationItems[destination.key] = error;
  }
  if (draft.destinations.length === 0) {
    errors.destinations = 'Add at least one destination.';
  } else if (draft.destinations.length > TRIP_LIMITS.destinationsMax) {
    errors.destinations = `Up to ${TRIP_LIMITS.destinationsMax} destinations.`;
  } else if (Object.keys(destinationItems).length > 0) {
    errors.destinations = Object.values(destinationItems)[0];
    errors.destinationItems = destinationItems;
  }

  if (!draft.category) {
    errors.category = 'Pick the kind of trip.';
  } else if (!isTripCategory(draft.category)) {
    errors.category = 'Choose a category from the list.';
  }

  if (!draft.startDate || !isValidISODate(draft.startDate)) {
    errors.startDate = 'Choose a start date.';
  } else if (draft.startDate < options.minStartDate) {
    errors.startDate = 'The trip cannot start in the past.';
  }

  if (!draft.endDate || !isValidISODate(draft.endDate)) {
    errors.endDate = 'Choose an end date.';
  } else if (draft.startDate && isValidISODate(draft.startDate)) {
    if (draft.endDate < draft.startDate) {
      errors.endDate = 'The trip must end on or after it starts.';
    } else if (diffInDays(draft.startDate, draft.endDate) + 1 > TRIP_LIMITS.maxDurationDays) {
      errors.endDate = `Trips can last up to ${TRIP_LIMITS.maxDurationDays} days.`;
    }
  }

  // Travellers: at least one, every row named.
  const travellerItems: Record<string, string> = {};
  for (const traveller of draft.travellers) {
    const name = traveller.name.trim();
    if (name.length === 0) travellerItems[traveller.key] = 'Enter a name or remove this traveller.';
    else if (name.length > TRIP_LIMITS.travellerNameMax)
      travellerItems[traveller.key] = `Keep names under ${TRIP_LIMITS.travellerNameMax} characters.`;
    else if (!isTravellerKind(traveller.kind)) travellerItems[traveller.key] = 'Choose adult or child.';
  }
  if (draft.travellers.length < TRIP_LIMITS.travellersMin) {
    errors.travellers = 'Add at least one traveller.';
  } else if (draft.travellers.length > TRIP_LIMITS.travellersMax) {
    errors.travellers = `Up to ${TRIP_LIMITS.travellersMax} travellers.`;
  } else if (Object.keys(travellerItems).length > 0) {
    errors.travellers = Object.values(travellerItems)[0];
    errors.travellerItems = travellerItems;
  }

  if (!draft.transportMode) {
    errors.transportMode = 'How are you travelling?';
  } else if (!isTransportMode(draft.transportMode)) {
    errors.transportMode = 'Choose a transport mode from the list.';
  }

  return errors;
}

/** Errors limited to the given fields (used to validate one wizard step at a time). */
export function pickErrors(errors: TripDraftErrors, fields: readonly TripDraftField[]): TripDraftErrors {
  const picked: TripDraftErrors = {};
  for (const field of fields) {
    if (errors[field]) picked[field] = errors[field];
  }
  if (fields.includes('destinations') && errors.destinationItems) {
    picked.destinationItems = errors.destinationItems;
  }
  if (fields.includes('travellers') && errors.travellerItems) {
    picked.travellerItems = errors.travellerItems;
  }
  return picked;
}

export function hasErrors(errors: TripDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Converts a fully valid draft into repository input; throws if invalid. */
export function draftToTripInput(draft: TripDraft, options: ValidationOptions): TripInput {
  const errors = validateTripDraft(draft, options);
  const firstError = (Object.keys(errors) as (keyof TripDraftErrors)[])
    .map((key) => errors[key])
    .find((value): value is string => typeof value === 'string');
  if (firstError) {
    throw new Error(firstError);
  }
  if (
    !draft.startDate ||
    !draft.endDate ||
    !isTransportMode(draft.transportMode) ||
    !isTripCategory(draft.category)
  ) {
    throw new Error('Trip details are incomplete.');
  }
  return {
    name: draft.name.trim(),
    destinations: draft.destinations.map(({ id, name }) => ({
      ...(id ? { id } : {}),
      name: name.trim(),
    })),
    startDate: draft.startDate,
    endDate: draft.endDate,
    travellers: draft.travellers.map(({ id, name, kind }) => ({
      ...(id ? { id } : {}),
      name: name.trim(),
      kind,
    })),
    transportMode: draft.transportMode,
    category: draft.category,
  };
}

/** Prefills the form from a saved trip; row keys are the saved ids. */
export function tripToDraft(trip: Trip): TripDraft {
  return {
    name: trip.name,
    destinations: trip.destinations.map(({ id, name }) => ({ key: id, id, name })),
    startDate: trip.startDate,
    endDate: trip.endDate,
    travellers: trip.travellers.map(({ id, name, kind }) => ({ key: id, id, name, kind })),
    transportMode: trip.transportMode,
    category: trip.category,
  };
}

export function editMinStartDate(savedStart: ISODate, today: ISODate): ISODate {
  return savedStart < today ? savedStart : today;
}
