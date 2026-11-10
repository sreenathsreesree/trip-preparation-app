import { diffInDays, isValidISODate, type ISODate } from '@/lib/dates';

import { isTransportMode, isTripCategory, type NewTripInput } from './model';

export const TRIP_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  destinationMin: 2,
  destinationMax: 80,
  maxDurationDays: 365,
  adultsMin: 1,
  adultsMax: 20,
  childrenMin: 0,
  childrenMax: 20,
} as const;

/** The editable state of the Create Trip flow; every field may be incomplete. */
export interface TripDraft {
  name: string;
  destination: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  adults: number;
  children: number;
  transportMode: string | null;
  category: string | null;
}

export type TripDraftField = keyof TripDraft;
export type TripDraftErrors = Partial<Record<TripDraftField, string>>;

export function validateTripDraft(draft: TripDraft, today: ISODate): TripDraftErrors {
  const errors: TripDraftErrors = {};
  const name = draft.name.trim();
  const destination = draft.destination.trim();

  if (name.length === 0) {
    errors.name = 'Give your trip a name.';
  } else if (name.length < TRIP_LIMITS.nameMin) {
    errors.name = `Use at least ${TRIP_LIMITS.nameMin} characters.`;
  } else if (name.length > TRIP_LIMITS.nameMax) {
    errors.name = `Keep it under ${TRIP_LIMITS.nameMax} characters.`;
  }

  if (destination.length === 0) {
    errors.destination = 'Where are you headed?';
  } else if (destination.length < TRIP_LIMITS.destinationMin) {
    errors.destination = `Use at least ${TRIP_LIMITS.destinationMin} characters.`;
  } else if (destination.length > TRIP_LIMITS.destinationMax) {
    errors.destination = `Keep it under ${TRIP_LIMITS.destinationMax} characters.`;
  }

  if (!draft.category) {
    errors.category = 'Pick the kind of trip.';
  } else if (!isTripCategory(draft.category)) {
    errors.category = 'Choose a category from the list.';
  }

  if (!draft.startDate || !isValidISODate(draft.startDate)) {
    errors.startDate = 'Choose a start date.';
  } else if (draft.startDate < today) {
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

  if (
    !Number.isInteger(draft.adults) ||
    draft.adults < TRIP_LIMITS.adultsMin ||
    draft.adults > TRIP_LIMITS.adultsMax
  ) {
    errors.adults = `Between ${TRIP_LIMITS.adultsMin} and ${TRIP_LIMITS.adultsMax} adults.`;
  }
  if (
    !Number.isInteger(draft.children) ||
    draft.children < TRIP_LIMITS.childrenMin ||
    draft.children > TRIP_LIMITS.childrenMax
  ) {
    errors.children = `Up to ${TRIP_LIMITS.childrenMax} children.`;
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
  return picked;
}

export function hasErrors(errors: TripDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Converts a fully valid draft into repository input; throws if invalid. */
export function draftToTripInput(draft: TripDraft, today: ISODate): NewTripInput {
  const errors = validateTripDraft(draft, today);
  const firstError = Object.values(errors)[0];
  if (firstError) {
    throw new Error(firstError);
  }
  // Narrowing is guaranteed by validation above.
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
    destination: draft.destination.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    travellers: { adults: draft.adults, children: draft.children },
    transportMode: draft.transportMode,
    category: draft.category,
  };
}
