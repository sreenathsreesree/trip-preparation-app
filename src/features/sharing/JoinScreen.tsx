import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, Notice } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { isCloudConfigured } from '@/features/auth/supabase';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { parseInviteToken } from './sharingService';
import { useSharingStore } from './sharingStore';

/** Opened from an invitation link (tripprep://join/<token>). Joining needs an explicit tap. */
export function JoinScreen({ token }: { token: string | undefined }) {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = token ? parseInviteToken(token) : null;

  async function join() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const tripId = await useSharingStore.getState().join(parsed);
      router.replace({ pathname: '/trips/[tripId]', params: { tripId } });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not join the trip.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="join-screen" bottomInset>
      <ScreenHeader showBack title="Join a shared trip" />
      {!parsed ? (
        <Notice tone="danger" title="This invitation link isn’t valid" message="Ask the trip owner to send a new one." testID="join-invalid" />
      ) : !isCloudConfigured() ? (
        <Notice tone="info" title="Sharing isn’t available in this build" testID="join-unavailable" />
      ) : !signedIn ? (
        <Notice
          tone="info"
          title="Sign in to join"
          message="Sign in with Google, then open the link again."
          action={{ label: 'Sign in', icon: 'login', onPress: () => router.push('/auth/sign-in') }}
          testID="join-signin"
        />
      ) : (
        <Card>
          <View style={styles.group}>
            <AppText variant="body">
              You’ve been invited to a shared trip. Joining adds it to your trips. The other members will see your name and the journal entries you choose to share — nothing else from your device.
            </AppText>
            <Button label="Join trip" icon="account-multiple-plus-outline" loading={busy} onPress={() => void join()} testID="join-accept" />
            {error ? <Notice tone="danger" title={error} testID="join-error" /> : null}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.md,
  },
});
