import { useLocalSearchParams } from 'expo-router';

import { RouteScreen } from '@/features/planner/RouteScreen';

export default function RouteStopsRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <RouteScreen tripId={tripId} />;
}
