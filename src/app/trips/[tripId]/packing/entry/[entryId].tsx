import { useLocalSearchParams } from 'expo-router';

import { EntryEditorScreen } from '@/features/packing/EntryEditorScreen';

export default function PackingEntryRoute() {
  const { tripId, entryId } = useLocalSearchParams<{ tripId: string; entryId: string }>();
  return <EntryEditorScreen tripId={tripId} entryId={entryId} />;
}
