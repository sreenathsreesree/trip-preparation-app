import { useLocalSearchParams } from 'expo-router';

import { EditTemplateScreen } from '@/features/preparation/components/TemplateFormScreen';

export default function EditTemplateRoute() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  return <EditTemplateScreen templateId={templateId} />;
}
