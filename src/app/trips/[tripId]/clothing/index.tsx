import { useLocalSearchParams } from 'expo-router';

import { ClothingScreen } from '@/features/clothing/ClothingScreen';

export default function ClothingRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ClothingScreen tripId={tripId} />;
}
