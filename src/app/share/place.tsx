import { useLocalSearchParams } from 'expo-router';

import { ShareToTripScreen } from '@/features/shareIntake/ShareToTripScreen';

export default function SharePlaceRoute() {
  const { text, subject } = useLocalSearchParams<{ text?: string; subject?: string }>();
  return <ShareToTripScreen text={text ?? ''} subject={subject ?? null} />;
}
