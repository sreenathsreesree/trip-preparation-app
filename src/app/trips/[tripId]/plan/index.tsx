import { useLocalSearchParams } from 'expo-router';

import { PlannerScreen } from '@/features/planner/PlannerScreen';

export default function PlannerRoute() {
  const { tripId, tab } = useLocalSearchParams<{ tripId: string; tab?: string }>();
  return <PlannerScreen tripId={tripId} initialTab={tab} />;
}
