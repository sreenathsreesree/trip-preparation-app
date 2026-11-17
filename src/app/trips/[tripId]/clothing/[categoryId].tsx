import { useLocalSearchParams } from 'expo-router';

import { ClothingSectionLauncher } from '@/features/preparation/components/ClothingSectionLauncher';

/** Old Clothing organiser link: Clothing now lives in the trip's Packing list. */
export default function ClothingRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ClothingSectionLauncher tripId={tripId} />;
}
