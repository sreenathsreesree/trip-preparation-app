import { useLocalSearchParams } from 'expo-router';

import { CompareScreen } from '@/features/planner/CompareScreen';

export default function CompareRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <CompareScreen tripId={tripId} />;
}
