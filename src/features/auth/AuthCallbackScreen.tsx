import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, ErrorState, LoadingState } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { useAuthStore } from './authStore';
import { AUTH_CALLBACK_PATH } from './redirect';

type Phase = 'working' | 'error';

/** Rebuilds the callback URL from the route's query parameters. */
export function callbackUrlFromParams(params: Record<string, string | string[] | undefined>): string {
  const query = Object.entries(params)
    .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value] as const)
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${AUTH_CALLBACK_PATH}${query ? `?${query}` : ''}`;
}

/**
 * Landing route for `tripprep://auth/callback` (and `/auth/callback` on web).
 * Completes sign-in through the shared, once-only code exchange, then returns to
 * the Profile tab. Opening it without a code simply goes back.
 */
export function AuthCallbackScreen({ params }: { params: Record<string, string | string[] | undefined> }) {
  const handleRedirect = useAuthStore((state) => state.handleRedirect);
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Web popup flow: hand the URL back to the window that opened the popup.
    if (Platform.OS === 'web' && WebBrowser.maybeCompleteAuthSession().type === 'success') return;

    void handleRedirect(callbackUrlFromParams(params)).then((outcome) => {
      if (outcome.status === 'error') {
        setMessage(outcome.message);
        setPhase('error');
      } else {
        router.dismissTo('/profile');
      }
    });
  }, [handleRedirect, params]);

  return (
    <View style={styles.root} testID="auth-callback-screen">
      {phase === 'working' ? (
        <LoadingState label="Finishing sign-in…" />
      ) : (
        <View style={styles.error}>
          <ErrorState title="Sign-in did not complete" message={message ?? 'Please try again.'} />
          <Button label="Back to Profile" variant="secondary" onPress={() => router.dismissTo('/profile')} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  error: {
    alignItems: 'center',
    gap: spacing.lg,
  },
});
