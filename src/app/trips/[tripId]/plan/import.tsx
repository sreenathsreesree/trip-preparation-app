import { useLocalSearchParams } from 'expo-router';

import { ImportPlanScreen } from '@/features/pdfImport/ImportPlanScreen';

export default function ImportPlanRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <ImportPlanScreen tripId={tripId} />;
}
