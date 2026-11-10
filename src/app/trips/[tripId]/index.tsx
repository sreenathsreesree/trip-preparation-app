import { useLocalSearchParams } from 'expo-router';

import { TripDashboard } from '@/features/trips/components/TripDashboard';

export default function TripDashboardRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <TripDashboard tripId={tripId} />;
}
