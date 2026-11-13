import { useLocalSearchParams } from 'expo-router';

import { GroupTripScreen } from '@/features/group/GroupTripScreen';

export default function GroupTripRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <GroupTripScreen tripId={tripId} />;
}
