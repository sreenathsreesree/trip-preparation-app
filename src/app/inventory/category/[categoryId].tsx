import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/features/inventory/CategoryScreens';

export default function CategoryRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  return <CategoryScreen categoryId={categoryId} />;
}
