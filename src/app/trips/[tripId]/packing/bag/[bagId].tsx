import { useLocalSearchParams } from 'expo-router';

import { BagEditorScreen } from '@/features/packing/BagEditorScreen';

export default function PackingBagRoute() {
  const { tripId, bagId } = useLocalSearchParams<{ tripId: string; bagId: string }>();
  return <BagEditorScreen tripId={tripId} bagId={bagId} />;
}
