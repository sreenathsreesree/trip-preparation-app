import { useLocalSearchParams } from 'expo-router';

import { SectionChecklist } from '@/features/preparation/components/SectionChecklist';

export default function SectionChecklistRoute() {
  const { tripId, section } = useLocalSearchParams<{ tripId: string; section: string }>();
  return <SectionChecklist tripId={tripId} section={section} />;
}
