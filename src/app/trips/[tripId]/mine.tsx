import { useLocalSearchParams } from 'expo-router';

import { MyTripScreen } from '@/features/group/MyTripScreen';

export default function MyTripRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <MyTripScreen tripId={tripId} />;
}
