import { useLocalSearchParams } from 'expo-router';

import { PackingScreen } from '@/features/packing/PackingScreen';

export default function PackingRoute() {
  const { tripId, tab } = useLocalSearchParams<{ tripId: string; tab?: string }>();
  return <PackingScreen tripId={tripId} initialTab={tab} />;
}
