import { diffInDays, type ISODate } from '@/lib/dates';
import type { IconName } from '@/theme/icons';

import type { ReadinessStats } from '../preparation/readiness';

export const TRANSPORT_MODES = ['car', 'bike', 'train', 'bus', 'flight', 'mixed'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

interface TransportModeMeta {
  label: string;
  icon: IconName;
  /** Whether the traveller drives their own vehicle and needs a readiness check. */
  needsVehicleReadiness: boolean;
}

export const TRANSPORT_MODE_META: Record<TransportMode, TransportModeMeta> = {
  car: { label: 'Car', icon: 'car-side', needsVehicleReadiness: true },
  bike: { label: 'Bike', icon: 'motorbike', needsVehicleReadiness: true },
  train: { label: 'Train', icon: 'train', needsVehicleReadiness: false },
  bus: { label: 'Bus', icon: 'bus', needsVehicleReadiness: false },
  flight: { label: 'Flight', icon: 'airplane', needsVehicleReadiness: false },
  mixed: { label: 'Mixed', icon: 'swap-horizontal-variant', needsVehicleReadiness: true },
};

export const TRIP_CATEGORIES = [
  'leisure',
  'business',
  'adventure',
  'pilgrimage',
  'family',
  'wedding',
  'beach',
  'mountains',
] as const;
export type TripCategory = (typeof TRIP_CATEGORIES)[number];

export const TRIP_CATEGORY_META: Record<TripCategory, { label: string; icon: IconName }> = {
  leisure: { label: 'Leisure', icon: 'palm-tree' },
  business: { label: 'Business', icon: 'briefcase-outline' },
  adventure: { label: 'Adventure', icon: 'hiking' },
  pilgrimage: { label: 'Pilgrimage', icon: 'temple-hindu' },
  family: { label: 'Family visit', icon: 'home-heart' },
  wedding: { label: 'Wedding', icon: 'ring' },
  beach: { label: 'Beach', icon: 'beach' },
  mountains: { label: 'Mountains', icon: 'image-filter-hdr' },
};

export const TRAVELLER_KINDS = ['adult', 'child'] as const;
export type TravellerKind = (typeof TRAVELLER_KINDS)[number];

export const TRAVELLER_KIND_META: Record<TravellerKind, { label: string; hint: string; icon: IconName }> = {
  adult: { label: 'Adult', hint: '12 and above', icon: 'account' },
  child: { label: 'Child', hint: 'Under 12', icon: 'human-child' },
};

export interface Destination {
  id: string;
  name: string;
}

export interface Traveller {
  id: string;
  name: string;
  kind: TravellerKind;
}

export interface Trip {
  id: string;
  name: string;
  /** Ordered stops; always at least one. */
  destinations: Destination[];
  startDate: ISODate;
  endDate: ISODate;
  /** Ordered; always at least one. */
  travellers: Traveller[];
  transportMode: TransportMode;
  category: TripCategory;
  /** Set when the user marks the trip as completed. */
  completedAt: string | null;
  /** Set when the trip is archived (hidden from active lists, fully restorable). */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Editable trip fields. Destination and traveller rows with an `id` update the
 * existing row (ids are preserved); rows without one are created.
 */
export interface TripInput {
  name: string;
  destinations: { id?: string; name: string }[];
  startDate: ISODate;
  endDate: ISODate;
  travellers: { id?: string; name: string; kind: TravellerKind }[];
  transportMode: TransportMode;
  category: TripCategory;
}

/** A trip plus checklist readiness, used by list and overview screens. */
export interface TripSummary extends Trip {
  readiness: ReadinessStats;
}

/** Where the trip sits in time (independent of the user's lifecycle actions). */
export type TripPhase = 'upcoming' | 'ongoing' | 'ended';

/** What the user has done with the trip. */
export type TripLifecycle = 'active' | 'completed' | 'archived';

export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && (TRANSPORT_MODES as readonly string[]).includes(value);
}

export function isTripCategory(value: unknown): value is TripCategory {
  return typeof value === 'string' && (TRIP_CATEGORIES as readonly string[]).includes(value);
}

export function isTravellerKind(value: unknown): value is TravellerKind {
  return typeof value === 'string' && (TRAVELLER_KINDS as readonly string[]).includes(value);
}

export function getTripPhase(trip: Pick<Trip, 'startDate' | 'endDate'>, today: ISODate): TripPhase {
  if (today < trip.startDate) return 'upcoming';
  if (today > trip.endDate) return 'ended';
  return 'ongoing';
}

export function getTripLifecycle(trip: Pick<Trip, 'completedAt' | 'archivedAt'>): TripLifecycle {
  if (trip.archivedAt) return 'archived';
  if (trip.completedAt) return 'completed';
  return 'active';
}

/** Active trips that have not ended yet — what Home and Checklists focus on. */
export function isCurrentTrip(
  trip: Pick<Trip, 'startDate' | 'endDate' | 'completedAt' | 'archivedAt'>,
  today: ISODate,
): boolean {
  return getTripLifecycle(trip) === 'active' && getTripPhase(trip, today) !== 'ended';
}

/** Short human status such as "In 12 days", "Tomorrow", "Day 2 of 5", "Ended". */
export function describeTripTiming(
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  today: ISODate,
): string {
  const phase = getTripPhase(trip, today);
  if (phase === 'ended') return 'Ended';
  if (phase === 'ongoing') {
    const day = diffInDays(trip.startDate, today) + 1;
    const total = diffInDays(trip.startDate, trip.endDate) + 1;
    return `Day ${day} of ${total}`;
  }
  const days = diffInDays(today, trip.startDate);
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/** "Manali → Kaza → Leh". */
export function formatRoute(destinations: readonly { name: string }[]): string {
  return destinations.map((destination) => destination.name).join(' → ');
}

export function countTravellers(travellers: readonly { kind: TravellerKind }[]): {
  adults: number;
  children: number;
} {
  let adults = 0;
  let children = 0;
  for (const traveller of travellers) {
    if (traveller.kind === 'child') children += 1;
    else adults += 1;
  }
  return { adults, children };
}

export function describeTravellers(travellers: readonly { kind: TravellerKind }[]): string {
  const { adults, children } = countTravellers(travellers);
  const parts: string[] = [];
  if (adults > 0) parts.push(`${adults} ${adults === 1 ? 'adult' : 'adults'}`);
  if (children > 0) parts.push(`${children} ${children === 1 ? 'child' : 'children'}`);
  return parts.length > 0 ? parts.join(', ') : 'No travellers';
}

/** Copy name for a duplicated trip or template, kept within `max` characters. */
export function copyName(name: string, max: number): string {
  const suffix = ' (copy)';
  const base = name.length + suffix.length > max ? name.slice(0, max - suffix.length).trimEnd() : name;
  return `${base}${suffix}`;
}
