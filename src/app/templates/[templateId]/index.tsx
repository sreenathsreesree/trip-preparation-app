import { useLocalSearchParams } from 'expo-router';

import { TemplateEditorScreen } from '@/features/preparation/components/TemplateEditorScreen';

export default function TemplateRoute() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  return <TemplateEditorScreen templateId={templateId} />;
}
