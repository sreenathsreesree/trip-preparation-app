import { useLocalSearchParams } from 'expo-router';

import { ShareScreen } from '@/features/sharing/ShareScreen';

export default function ShareRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ShareScreen tripId={tripId} />;
}
