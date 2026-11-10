import { useEffect, useMemo } from 'react';

import { todayISO, type ISODate } from '@/lib/dates';

import { isCurrentTrip } from './model';
import { selectTripById, useTripsStore } from './tripsStore';

/** Today's calendar date, fixed for the lifetime of the calling screen. */
export function useToday(): ISODate {
  return useMemo(() => todayISO(), []);
}

/** Ensures trips are loaded once the database is ready; safe to call from any screen. */
export function useEnsureTripsLoaded() {
  const status = useTripsStore((state) => state.status);
  const load = useTripsStore((state) => state.load);
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);
}

export function useTrip(tripId: string | undefined) {
  useEnsureTripsLoaded();
  const trip = useTripsStore(selectTripById(tripId));
  const status = useTripsStore((state) => state.status);
  const error = useTripsStore((state) => state.error);
  const load = useTripsStore((state) => state.load);
  return { trip, status, error, reload: load };
}

/** Active trips that are upcoming or in progress, nearest first. */
export function useCurrentTrips(today: ISODate) {
  const trips = useTripsStore((state) => state.trips);
  return useMemo(() => trips.filter((trip) => isCurrentTrip(trip, today)), [trips, today]);
}
