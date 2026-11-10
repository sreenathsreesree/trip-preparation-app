import { useLocalSearchParams } from 'expo-router';

import { ItemFormScreen } from '@/features/inventory/ItemFormScreen';

export default function NewItemRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId?: string }>();
  return <ItemFormScreen categoryId={categoryId} />;
}
