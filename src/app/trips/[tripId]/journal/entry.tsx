import { useLocalSearchParams } from 'expo-router';

import { EntryScreen } from '@/features/journal/EntryScreen';

export default function JournalEntryRoute() {
  const { tripId, entryId } = useLocalSearchParams<{ tripId: string; entryId?: string }>();
  return <EntryScreen tripId={tripId} entryId={entryId} />;
}
