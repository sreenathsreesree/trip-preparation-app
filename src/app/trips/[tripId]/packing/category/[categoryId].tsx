import { useLocalSearchParams } from 'expo-router';

import { CategoryPackingScreen } from '@/features/packing/CategoryPackingScreen';

export default function PackingCategoryRoute() {
  const { tripId, categoryId, traveller } = useLocalSearchParams<{ tripId: string; categoryId: string; traveller?: string }>();
  return <CategoryPackingScreen tripId={tripId} categoryId={categoryId} traveller={traveller} />;
}
