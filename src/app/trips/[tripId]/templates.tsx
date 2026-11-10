import { useLocalSearchParams } from 'expo-router';

import { ApplyTemplatesScreen } from '@/features/preparation/components/ApplyTemplatesScreen';

export default function ApplyTemplatesRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ApplyTemplatesScreen tripId={tripId} />;
}
