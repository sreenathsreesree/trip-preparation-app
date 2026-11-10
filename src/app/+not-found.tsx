import { router, Stack } from 'expo-router';

import { Screen } from '@/components/layout/Screen';
import { EmptyState } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen bottomInset>
        <EmptyState
          icon="compass-off-outline"
          title="Off the map"
          message="This screen doesn't exist."
          action={{ label: 'Go home', icon: 'home-variant', onPress: () => router.replace('/') }}
        />
      </Screen>
    </>
  );
}
