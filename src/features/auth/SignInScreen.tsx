import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, Icon, Notice } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { useAuthStore } from './authStore';

const POINTS = [
  { icon: 'cellphone-check', text: 'Your trips, checklists and inventory stay on this device, exactly as they are.' },
  { icon: 'cloud-lock-outline', text: 'Nothing is uploaded yet. Cloud backup and sync arrive in a later update.' },
  { icon: 'shield-account-outline', text: 'Google only confirms who you are. Trip Prep never sees your password.' },
] as const;

export function SignInScreen() {
  const configured = useAuthStore((state) => state.configured);
  const status = useAuthStore((state) => state.status);
  const pending = useAuthStore((state) => state.pending);
  const error = useAuthStore((state) => state.error);
  const notice = useAuthStore((state) => state.notice);
  const signIn = useAuthStore((state) => state.signIn);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  // Leave once signed in, whether through the browser result or a deep link.
  useEffect(() => {
    if (status === 'signedIn') router.dismissTo('/profile');
  }, [status]);

  // Messages belong to this visit only.
  useEffect(() => clearMessages, [clearMessages]);

  const busy = pending === 'signIn' || pending === 'callback';

  return (
    <Screen
      testID="sign-in-screen"
      bottomInset
      footer={
        configured ? (
          <Button
            label={busy ? 'Waiting for Google…' : 'Continue with Google'}
            icon="login"
            loading={busy}
            disabled={status === 'initializing'}
            fullWidth
            onPress={() => void signIn()}
            testID="sign-in-google"
          />
        ) : null
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow="Account" title="Sign in" />

      {error ? (
        <Notice
          tone="danger"
          title="Sign-in did not complete"
          message={error}
          testID="sign-in-error"
        />
      ) : null}
      {notice === 'cancelled' ? (
        <Notice
          tone="info"
          title="Sign-in cancelled"
          message="You are still using Trip Prep as a guest. Nothing on this device changed."
          testID="sign-in-cancelled"
        />
      ) : null}
      {!configured ? (
        <Notice
          tone="warning"
          title="Sign-in is not available in this build"
          message="Trip Prep works fully offline without an account."
          testID="sign-in-unavailable"
        />
      ) : null}

      <Card padding="xl" style={styles.card}>
        {POINTS.map((point) => (
          <View key={point.icon} style={styles.point}>
            <View style={styles.iconBox}>
              <Icon name={point.icon} tone="accent" />
            </View>
            <AppText variant="body" tone="textSecondary" style={styles.flex}>
              {point.text}
            </AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  point: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
});
