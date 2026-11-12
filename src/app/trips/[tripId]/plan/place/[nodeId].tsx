import { useLocalSearchParams } from 'expo-router';

import { isDetailTab } from '@/features/planner/detail/shared';
import { PlaceScreen } from '@/features/planner/PlaceScreen';

export default function PlaceRoute() {
  const { tripId, nodeId, tab } = useLocalSearchParams<{ tripId: string; nodeId: string; tab?: string }>();
  return <PlaceScreen tripId={tripId} nodeId={nodeId} tab={isDetailTab(tab) ? tab : undefined} />;
}
