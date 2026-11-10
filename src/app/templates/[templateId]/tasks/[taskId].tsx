import { useLocalSearchParams } from 'expo-router';

import { TaskEditorScreen } from '@/features/preparation/components/TaskEditorScreen';

export default function TemplateTaskRoute() {
  const { templateId, taskId } = useLocalSearchParams<{ templateId: string; taskId: string }>();
  return <TaskEditorScreen ownerType="template" ownerId={templateId} taskId={taskId} />;
}
