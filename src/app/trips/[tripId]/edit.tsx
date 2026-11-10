import { useLocalSearchParams } from 'expo-router';

import { EditTripScreen } from '@/features/trips/components/EditTripScreen';

export default function EditTripRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <EditTripScreen tripId={tripId} />;
}
