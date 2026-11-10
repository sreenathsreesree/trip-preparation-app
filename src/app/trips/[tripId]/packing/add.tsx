import { useLocalSearchParams } from 'expo-router';

import { AddToPackingScreen } from '@/features/packing/AddToPackingScreen';

export default function AddToPackingRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <AddToPackingScreen tripId={tripId} />;
}
