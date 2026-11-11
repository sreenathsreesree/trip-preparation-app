import { useLocalSearchParams } from 'expo-router';

import { TripDashboard } from '@/features/trips/components/TripDashboard';

export default function TripDashboardRoute() {
  const { tripId, created } = useLocalSearchParams<{ tripId: string; created?: string }>();
  return <TripDashboard tripId={tripId} justCreated={created === '1'} />;
}
