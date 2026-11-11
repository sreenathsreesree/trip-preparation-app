import { useLocalSearchParams } from 'expo-router';

import { AddPlaceScreen } from '@/features/planner/AddPlaceScreen';

export default function AddPlaceRoute() {
  const { tripId, parentId } = useLocalSearchParams<{ tripId: string; parentId?: string }>();
  return <AddPlaceScreen tripId={tripId} parentId={parentId} />;
}
