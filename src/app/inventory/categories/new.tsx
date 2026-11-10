import { useLocalSearchParams } from 'expo-router';

import { CategoryFormScreen } from '@/features/inventory/CategoryScreens';

export default function NewCategoryRoute() {
  const { parentId } = useLocalSearchParams<{ parentId?: string }>();
  return <CategoryFormScreen parentId={parentId} />;
}
