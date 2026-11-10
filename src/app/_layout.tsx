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
            <Stack.Screen name="trips/[tripId]/[section]" />
          </Stack>
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
