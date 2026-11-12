import { useLocalSearchParams } from 'expo-router';

import { isWorkspaceTab, WorkspaceScreen } from '@/features/expenses/WorkspaceScreen';

export default function TripCalculatorRoute() {
  const { tripId, tab } = useLocalSearchParams<{ tripId: string; tab?: string }>();
  return <WorkspaceScreen tripId={tripId} initialTab={isWorkspaceTab(tab) ? tab : 'expenses'} />;
}
