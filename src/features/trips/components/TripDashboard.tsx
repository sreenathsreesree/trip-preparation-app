import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Collapsible, EmptyState, ErrorState, IconButton, LoadingState, Notice } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';

import { PlanSummaryCard } from '../../planner/components/PlanSummaryCard';
import { TripWeatherCard } from '../../weather/components/TripWeatherCard';
import { useToday, useTrip } from '../hooks';
import { describeTripTiming, getTripLifecycle, getTripPhase, type TripSummary } from '../model';
import { useTripsStore } from '../tripsStore';
import { useTripActions } from './TripActions';
import { JourneyButton } from './dashboard/JourneyButton';
import { QuickLinks } from './dashboard/QuickLinks';
import { ReadinessSummary } from './dashboard/ReadinessSummary';
import { TripHero } from './dashboard/TripHero';

function LifecycleNotice({ trip, today }: { trip: TripSummary; today: string }) {
  const lifecycle = getTripLifecycle(trip);
  const [error, setError] = useState<string | null>(null);
  const store = useTripsStore.getState;
  const act = (fn: () => Promise<void>) => () => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'That did not work. Please try again.')));
  };

  let notice = null;
  if (lifecycle === 'archived') {
    notice = (
      <Notice
        tone="info"
        icon="archive-outline"
        title="This trip is archived"
        message="It is hidden from active lists. Everything is kept and still editable."
        action={{ label: 'Restore trip', icon: 'archive-arrow-up-outline', onPress: act(() => store().setArchived(trip.id, false)) }}
        testID="archived-notice"
      />
    );
  } else if (lifecycle === 'completed' && trip.completedAt) {
    notice = (
      <Notice
        tone="success"
        icon="flag-checkered"
        title={`Completed on ${formatDate(trip.completedAt.slice(0, 10), { withYear: true })}`}
        action={{ label: 'Reopen trip', icon: 'restore', onPress: act(() => store().setCompleted(trip.id, false)) }}
        testID="completed-notice"
      />
    );
  } else if (getTripPhase(trip, today) === 'ended') {
    notice = (
      <Notice
        tone="warning"
        icon="calendar-check-outline"
        title="This trip has ended"
        message="Mark it as completed to move it out of your active trips."
        action={{ label: 'Mark as completed', icon: 'flag-checkered', onPress: act(() => store().setCompleted(trip.id, true)) }}
      />
    );
  }
  return (
    <>
      {notice}
      {error ? <Notice tone="danger" title="Could not update the trip" message={error} /> : null}
    </>
  );
}

function DashboardBody({ trip, justCreated }: { trip: TripSummary; justCreated: boolean }) {
  const today = useToday();
  const [showCreated, setShowCreated] = useState(justCreated);
  const { openActions, sheet, error: tripActionError } = useTripActions(trip, {
    onDeleted: () => router.replace('/trips'),
  });

  // The travel command centre: an overview of the journey. Preparation tasks, sections and
  // checklist tools live only in the Checklist tab (opened from the readiness card).
  return (
    <Screen testID="trip-dashboard" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={describeTripTiming(trip, today)}
        title={trip.name}
        trailing={<IconButton icon="dots-horizontal" accessibilityLabel="Trip actions" onPress={openActions} testID="trip-actions" />}
      />

      {showCreated ? (
        <Notice
          tone="success"
          icon="check-circle-outline"
          title="Trip created"
          message={
            trip.destinations.length === 0
              ? 'Next, plan where you are going: add main destinations and the places you want to see.'
              : 'Next, plan the places you want to see and your route.'
          }
          action={{
            label: 'Start planning',
            icon: 'map-marker-plus-outline',
            onPress: () => {
              setShowCreated(false);
              router.push({ pathname: '/trips/[tripId]/plan', params: { tripId: trip.id } });
            },
          }}
          testID="trip-created-start-planning"
        />
      ) : null}

      <LifecycleNotice trip={trip} today={today} />
      {tripActionError ? <Notice tone="danger" title="Action failed" message={tripActionError} /> : null}

      <TripHero trip={trip} />
      <PlanSummaryCard trip={trip} />
      <ReadinessSummary tripId={trip.id} />
      <JourneyButton trip={trip} today={today} />
      <QuickLinks tripId={trip.id} />

      <Collapsible title="Weather" icon="weather-partly-cloudy" summary="Forecast along your destinations — tap to show" testID="trip-weather-section">
        <TripWeatherCard trip={trip} />
      </Collapsible>

      {sheet}
    </Screen>
  );
}

export function TripDashboard({ tripId, justCreated = false }: { tripId: string | undefined; justCreated?: boolean }) {
  const { trip, status, error, reload } = useTrip(tripId);

  if (trip) return <DashboardBody trip={trip} justCreated={justCreated} />;

  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Trip" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="map-marker-question-outline"
          title="Trip not found"
          message="It may have been deleted from this device."
          action={{ label: 'View all trips', onPress: () => router.replace('/trips') }}
        />
      ) : (
        <LoadingState label="Loading trip…" />
      )}
    </Screen>
  );
}

