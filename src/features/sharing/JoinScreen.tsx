import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, Notice, TextField } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { isCloudConfigured } from '@/features/auth/supabase';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { parseInviteToken } from './inviteLinks';
import { useSharingStore } from './sharingStore';

/**
 * Opened from an invitation link (https://<host>/join/<token> or
 * tripprep://join/<token>), or from Trips → Join a trip with a pasted code or
 * link. Joining always needs an explicit tap; expiry, revocation and the use
 * limit are checked by the server when accepting.
 */
export function JoinScreen({ token, manual = false }: { token: string | undefined; manual?: boolean }) {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const parsed = manual ? parseInviteToken(typed) : token ? parseInviteToken(token) : null;

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
      {manual ? (
        <Card>
          <View style={styles.group}>
            <TextField
              label="Invitation link or code"
              value={typed}
              onChangeText={setTyped}
              placeholder="Paste the link or code you received"
              autoCapitalize="none"
              autoCorrect={false}
              testID="join-code"
            />
            {typed.trim() && !parsed ? <AppText variant="caption" tone="danger" testID="join-code-invalid">That doesn’t look like a Trip Prep invitation.</AppText> : null}
          </View>
        </Card>
      ) : null}
      {manual && !parsed ? null : !parsed ? (
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
