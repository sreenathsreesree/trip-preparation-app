import { useLocalSearchParams } from 'expo-router';

import { SectionsManagerScreen } from '@/features/preparation/components/SectionsManagerScreen';
import { useTemplatesStore } from '@/features/preparation/templatesStore';

export default function TemplateSectionsRoute() {
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  const name = useTemplatesStore((state) => state.templates.find((t) => t.id === templateId)?.name);
  return <SectionsManagerScreen ownerType="template" ownerId={templateId} ownerName={name} />;
}
