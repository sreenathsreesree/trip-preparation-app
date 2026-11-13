import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, Notice } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { colors, spacing } from '@/theme';

import { useAuthStore } from './authStore';
import { UserBadge } from './components/UserBadge';

/** Signed-in account details and sign-out. Protected: only reachable when signed in. */
export function AccountScreen() {
  const user = useAuthStore((state) => state.user);
  const offline = useAuthStore((state) => state.offline);
  const pending = useAuthStore((state) => state.pending);
  const signOut = useAuthStore((state) => state.signOut);

  const onSignOut = async () => {
    const confirmed = await confirmAction({
      title: 'Sign out?',
      message: 'Your trips, checklists and inventory stay on this device. You can sign in again at any time.',
      confirmLabel: 'Sign out',
    });
    if (confirmed) await signOut();
  };

  return (
    <Screen testID="account-screen" bottomInset>
      <ScreenHeader showBack eyebrow="Profile" title="Account" />

      {user ? (
        <Card padding="xl" style={styles.card}>
          <UserBadge user={user} />
          <View style={styles.divider} />
          <AppText variant="caption" tone="textMuted">
            Signed in with Google
          </AppText>
        </Card>
      ) : null}

      {offline ? (
        <Notice
          tone="info"
          title="Offline"
          message="Your account reconnects automatically when the device is back online."
        />
      ) : null}

      <Notice
        tone="info"
        icon="cloud-lock-outline"
        title="Your trips belong to this account"
        message="Each Google account has its own trips on this phone, and the guest has separate ones. Signing out keeps this account’s trips on the phone, hidden until you sign in again. Backup status is on the Profile tab."
      />

      <Button
        label="Sign out"
        icon="logout"
        variant="danger"
        loading={pending === 'signOut'}
        onPress={() => void onSignOut()}
        testID="account-sign-out"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
});
