import { useLocalSearchParams } from 'expo-router';

import { AuthCallbackScreen } from '@/features/auth/AuthCallbackScreen';

export default function AuthCallbackRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <AuthCallbackScreen params={params} />;
}
