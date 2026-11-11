import { useLocalSearchParams } from 'expo-router';

import { PlaceScreen } from '@/features/planner/PlaceScreen';

export default function PlaceRoute() {
  const { tripId, nodeId } = useLocalSearchParams<{ tripId: string; nodeId: string }>();
  return <PlaceScreen tripId={tripId} nodeId={nodeId} />;
}
