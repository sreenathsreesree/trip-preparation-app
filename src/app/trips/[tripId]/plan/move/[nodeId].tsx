import { useLocalSearchParams } from 'expo-router';

import { MoveScreen } from '@/features/planner/MoveScreen';

export default function MovePlaceRoute() {
  const { tripId, nodeId } = useLocalSearchParams<{ tripId: string; nodeId: string }>();
  return <MoveScreen tripId={tripId} nodeId={nodeId} />;
}
