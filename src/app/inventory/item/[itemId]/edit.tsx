import { useLocalSearchParams } from 'expo-router';

import { ItemFormScreen } from '@/features/inventory/ItemFormScreen';

export default function EditItemRoute() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  return <ItemFormScreen itemId={itemId} />;
}
