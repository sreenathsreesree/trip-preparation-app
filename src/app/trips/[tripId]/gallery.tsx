import { useLocalSearchParams } from 'expo-router';

import { MemoriesScreen } from '@/features/memories/MemoriesScreen';

export default function TripMemoriesRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <MemoriesScreen tripId={tripId} />;
}
