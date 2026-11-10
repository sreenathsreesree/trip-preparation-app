import { useLocalSearchParams } from 'expo-router';

import { SectionsManagerScreen } from '@/features/preparation/components/SectionsManagerScreen';
import { useTrip } from '@/features/trips/hooks';

export default function TripSectionsRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { trip } = useTrip(tripId);
  return <SectionsManagerScreen ownerType="trip" ownerId={tripId} ownerName={trip?.name} />;
}
