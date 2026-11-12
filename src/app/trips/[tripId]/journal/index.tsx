import { useLocalSearchParams } from 'expo-router';

import { JournalScreen } from '@/features/journal/JournalScreen';

export default function JournalRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <JournalScreen tripId={tripId} />;
}
