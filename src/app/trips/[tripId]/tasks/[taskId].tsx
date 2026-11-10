import { useLocalSearchParams } from 'expo-router';

import { TaskEditorScreen } from '@/features/preparation/components/TaskEditorScreen';

export default function TripTaskRoute() {
  const { tripId, taskId } = useLocalSearchParams<{ tripId: string; taskId: string }>();
  return <TaskEditorScreen ownerType="trip" ownerId={tripId} taskId={taskId} />;
}
