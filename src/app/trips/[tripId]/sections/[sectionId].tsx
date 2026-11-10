import { useLocalSearchParams } from 'expo-router';

import { TripSectionScreen } from '@/features/preparation/components/TripSectionScreen';

export default function TripSectionRoute() {
  const { tripId, sectionId } = useLocalSearchParams<{ tripId: string; sectionId: string }>();
  return <TripSectionScreen tripId={tripId} sectionId={sectionId} />;
}
