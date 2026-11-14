import { useLocalSearchParams } from 'expo-router';

import { ClothingCategoryScreen } from '@/features/clothing/ClothingCategoryScreen';

export default function ClothingCategoryRoute() {
  const { tripId, categoryId } = useLocalSearchParams<{ tripId: string; categoryId: string }>();
  return <ClothingCategoryScreen tripId={tripId} categoryId={categoryId} />;
}
