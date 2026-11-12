import { useLocalSearchParams } from 'expo-router';

import { JoinScreen } from '@/features/sharing/JoinScreen';

export default function JoinRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <JoinScreen token={token} />;
}
