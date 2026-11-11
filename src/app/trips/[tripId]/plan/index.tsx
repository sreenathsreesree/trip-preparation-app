import { useLocalSearchParams } from 'expo-router';

import { PlannerScreen } from '@/features/planner/PlannerScreen';

export default function PlannerRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <PlannerScreen tripId={tripId} />;
}
