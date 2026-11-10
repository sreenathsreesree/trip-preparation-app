import { useLocalSearchParams } from 'expo-router';

import { ItemDetailScreen } from '@/features/inventory/ItemDetailScreen';

export default function ItemDetailRoute() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  return <ItemDetailScreen itemId={itemId} />;
}
