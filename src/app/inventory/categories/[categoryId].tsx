import { useLocalSearchParams } from 'expo-router';

import { CategoryFormScreen } from '@/features/inventory/CategoryScreens';

export default function EditCategoryRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  return <CategoryFormScreen categoryId={categoryId} />;
}
