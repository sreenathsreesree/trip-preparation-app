import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorState } from '@/components/ui';
import { getDatabase } from '@/db/client';
import { useAuthStore } from '@/features/auth/authStore';
import { PhotoUploadWatcher } from '@/features/journal/components/PhotoUploadWatcher';
import { ArrivalWatcher } from '@/features/planner/components/ArrivalWatcher';
import { colors } from '@/theme';
import { navigationTheme } from '@/theme/navigation';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Shown by Expo Router if a screen throws during render. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.fallback}>
      <ErrorState
        title="This screen hit a snag"
        message={error.message || 'An unexpected error occurred.'}
        onRetry={() => void retry()}
      />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const [databaseSettled, setDatabaseSettled] = useState(false);

  // Open + migrate the database while the splash screen is up. Screens load
  // their data through the stores, which surface any failure with a retry.
  useEffect(() => {
    getDatabase()
      .catch(() => undefined)
      .finally(() => setDatabaseSettled(true));
  }, []);

  // Restore the account session in the background; it never blocks the app and
  // never touches local data. Guests are unaffected.
  const initializeAuth = useAuthStore((state) => state.initialize);
  const signedIn = useAuthStore((state) => state.status === 'signedIn');
  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  const fontsReady = fontsLoaded || Boolean(fontError);
  const ready = fontsReady && databaseSettled;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Fall back to system fonts rather than blocking if font loading fails.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/index" />
            <Stack.Screen name="trips/[tripId]/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/sections/index" />
            <Stack.Screen name="trips/[tripId]/sections/[sectionId]" />
            <Stack.Screen name="trips/[tripId]/tasks/[taskId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/templates" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/save-template" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/plan/index" />
            <Stack.Screen name="trips/[tripId]/plan/add" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/plan/place/[nodeId]" />
            <Stack.Screen name="trips/[tripId]/plan/move/[nodeId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/plan/route" />
            <Stack.Screen name="trips/[tripId]/packing/index" />
            <Stack.Screen name="trips/[tripId]/packing/category/[categoryId]" />
            <Stack.Screen name="trips/[tripId]/packing/add" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/packing/entry/[entryId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="trips/[tripId]/packing/bag/[bagId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="inventory/item/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="inventory/item/[itemId]/index" />
            <Stack.Screen name="inventory/item/[itemId]/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="inventory/category/[categoryId]" />
            <Stack.Screen name="inventory/categories/index" />
            <Stack.Screen name="inventory/categories/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="inventory/categories/[categoryId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="inventory/shopping" />
            <Stack.Screen name="templates/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="templates/[templateId]/index" />
            <Stack.Screen name="templates/[templateId]/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="templates/[templateId]/sections" />
            <Stack.Screen name="templates/[templateId]/tasks/[taskId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/sign-in" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/callback" options={{ animation: 'fade' }} />
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="account/index" />
            </Stack.Protected>
          </Stack>
          <ArrivalWatcher />
          <PhotoUploadWatcher />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fallback: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
