import { router } from 'expo-router';

import { Button } from '@/components/ui';

import { routeNodes } from '../../../planner/model';
import { useTripPlan } from '../../../planner/plannerStore';
import { journeyState } from '../../../preparation/progress';
import { getTripLifecycle, getTripPhase, type TripSummary } from '../../model';

/**
 * Start / Continue / Completed journey. Opens the journey (Navigation) view or,
 * once the journey is done, the trip's Memories. It never starts turn-by-turn
 * navigation by itself: Google Maps opens only when the user taps a leg there.
 */
export function JourneyButton({ trip, today }: { trip: TripSummary; today: string }) {
  const { plan, companion } = useTripPlan(trip.id);
  const stops = plan ? routeNodes(plan).filter((n) => n.parentId === null) : [];
  const visited = new Set((companion?.profiles ?? []).filter((p) => p.visitStatus === 'visited').map((p) => p.nodeId));
  const state = journeyState({
    phase: getTripPhase(trip, today),
    completed: getTripLifecycle(trip) === 'completed',
    routeStops: stops.length,
    visitedStops: stops.filter((s) => visited.has(s.id)).length,
  });
  if (state === 'completed') {
    return (
      <Button
        label="Journey completed · Memories"
        icon="image-multiple-outline"
        variant="secondary"
        onPress={() => router.push({ pathname: '/trips/[tripId]/gallery', params: { tripId: trip.id } })}
        testID="journey-button"
      />
    );
  }
  return (
    <Button
      label={state === 'in_progress' ? 'Continue journey' : 'Start journey'}
      icon={state === 'in_progress' ? 'navigation-variant' : 'navigation-variant-outline'}
      variant="secondary"
      onPress={() => router.push({ pathname: '/trips/[tripId]/plan', params: { tripId: trip.id, tab: 'navigation' } })}
      testID="journey-button"
    />
  );
}
