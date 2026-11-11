import { useLocalSearchParams } from 'expo-router';

import { AddToPackingScreen } from '@/features/packing/AddToPackingScreen';

export default function AddToPackingRoute() {
  const { tripId, category } = useLocalSearchParams<{ tripId: string; category?: string }>();
  return <AddToPackingScreen tripId={tripId} categoryKey={category} />;
}
