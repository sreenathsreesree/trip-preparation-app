import { PlannerScreen } from './PlannerScreen';

/** `/trips/[tripId]/plan/route` opens the planner on its Route tab. */
export function RouteScreen({ tripId }: { tripId: string | undefined }) {
  return <PlannerScreen tripId={tripId} initialTab="route" />;
}
