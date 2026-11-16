import { useLocalSearchParams } from 'expo-router';

import { ClothingSectionLauncher } from '@/features/preparation/components/ClothingSectionLauncher';

export default function ClothingChecklistRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ClothingSectionLauncher tripId={tripId} />;
}
