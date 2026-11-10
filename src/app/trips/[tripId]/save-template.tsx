import { useLocalSearchParams } from 'expo-router';

import { SaveTripAsTemplateScreen } from '@/features/preparation/components/TemplateFormScreen';

export default function SaveTripAsTemplateRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <SaveTripAsTemplateScreen tripId={tripId} />;
}
