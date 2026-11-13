import { useLocalSearchParams } from 'expo-router';

import { GalleryScreen } from '@/features/journal/gallery/GalleryScreen';

export default function TripGalleryRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <GalleryScreen tripId={tripId} />;
}
