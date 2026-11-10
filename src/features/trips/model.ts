import { diffInDays, type ISODate } from '@/lib/dates';
import type { IconName } from '@/theme/icons';

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

export interface Travellers {
  adults: number;
  children: number;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: ISODate;
  endDate: ISODate;
  travellers: Travellers;
  transportMode: TransportMode;
  category: TripCategory;
  createdAt: string;
  updatedAt: string;
}

export type NewTripInput = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>;

export interface PrepProgress {
  total: number;
  done: number;
}

/** A trip plus aggregate checklist progress, used by list and overview screens. */
export interface TripSummary extends Trip {
  progress: PrepProgress;
}

export type TripPhase = 'upcoming' | 'ongoing' | 'completed';

export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === 'string' && (TRANSPORT_MODES as readonly string[]).includes(value);
}

export function isTripCategory(value: unknown): value is TripCategory {
  return typeof value === 'string' && (TRIP_CATEGORIES as readonly string[]).includes(value);
}

export function getTripPhase(trip: Pick<Trip, 'startDate' | 'endDate'>, today: ISODate): TripPhase {
  if (today < trip.startDate) return 'upcoming';
  if (today > trip.endDate) return 'completed';
  return 'ongoing';
}

/** Short human status such as "In 12 days", "Tomorrow", "Day 2 of 5", "Completed". */
export function describeTripTiming(
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  today: ISODate,
): string {
  const phase = getTripPhase(trip, today);
  if (phase === 'completed') return 'Completed';
  if (phase === 'ongoing') {
    const day = diffInDays(trip.startDate, today) + 1;
    const total = diffInDays(trip.startDate, trip.endDate) + 1;
    return `Day ${day} of ${total}`;
  }
  const days = diffInDays(today, trip.startDate);
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export function travellerCount(travellers: Travellers): number {
  return travellers.adults + travellers.children;
}

export function describeTravellers({ adults, children }: Travellers): string {
  const adultLabel = `${adults} ${adults === 1 ? 'adult' : 'adults'}`;
  if (children === 0) return adultLabel;
  return `${adultLabel}, ${children} ${children === 1 ? 'child' : 'children'}`;
}

export function progressRatio({ total, done }: PrepProgress): number {
  return total === 0 ? 0 : done / total;
}
