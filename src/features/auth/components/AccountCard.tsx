import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { useAuthStore, type AuthNotice } from '../authStore';
import { UserBadge } from './UserBadge';

const NOTICES: Record<Exclude<AuthNotice, 'cancelled'>, { tone: 'info' | 'warning' | 'success'; title: string; message: string }> = {
  expired: {
    tone: 'warning',
    title: 'Your sign-in expired',
    message: 'Sign in again to reconnect your account. Everything on this device is unchanged.',
  },
  signedOut: {
    tone: 'success',
    title: 'Signed out',
    message: 'Your trips, checklists and inventory are still on this device.',
  },
  signedOutOffline: {
    tone: 'info',
    title: 'Signed out on this device',
    message:
      'The server could not be reached to end the session; it will expire on its own. Your local data is unchanged.',
  },
};

/** Account entry on the Profile tab: guest, signed-in or not-configured states. */
export function AccountCard() {
  const configured = useAuthStore((state) => state.configured);
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const offline = useAuthStore((state) => state.offline);
  const notice = useAuthStore((state) => state.notice);
  const clearMessages = useAuthStore((state) => state.clearMessages);

  const visibleNotice = notice && notice !== 'cancelled' ? NOTICES[notice] : null;

  if (!configured) {
    // No Supabase configuration in this build: offline-only, no sign-in control.
    return (
      <Card variant="accent" padding="xl" testID="account-card-offline-only">
        <View style={styles.row}>
          <View style={styles.iconBox}>
            <Icon name="cloud-off-outline" tone="accent" size={24} />
          </View>
          <View style={styles.flex}>
            <AppText variant="h3">Offline-first, no account needed</AppText>
            <AppText variant="body" tone="textSecondary">
              Everything you plan is stored on this device and works without a connection. Sign-in is not
              available in this build.
            </AppText>
          </View>
        </View>
      </Card>
    );
  }

  return (
    <View style={styles.group}>
      {visibleNotice ? (
        <Notice
          tone={visibleNotice.tone}
          title={visibleNotice.title}
          message={visibleNotice.message}
          action={{ label: 'OK', onPress: clearMessages }}
          testID={`account-notice-${notice}`}
        />
      ) : null}

      {status === 'signedIn' && user ? (
        <Card variant="accent" padding="xl" style={styles.card} testID="account-card-signed-in">
          <UserBadge user={user} />
          <AppText variant="body" tone="textSecondary">
            {offline
              ? 'Signed in. You are offline; your account reconnects automatically when you are back online.'
              : 'Signed in with Google. Cloud backup is not switched on yet, so your trips stay on this device for now.'}
          </AppText>
          <Button
            label="Account"
            icon="account-cog-outline"
            variant="secondary"
            onPress={() => router.push('/account')}
            testID="account-open"
          />
        </Card>
      ) : (
        <Card variant="accent" padding="xl" style={styles.card} testID="account-card-guest">
          <View style={styles.row}>
            <View style={styles.iconBox}>
              <Icon name="account-outline" tone="accent" size={24} />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3">{status === 'initializing' ? 'Checking your account…' : 'Using Trip Prep as a guest'}</AppText>
              <AppText variant="body" tone="textSecondary">
                Everything you plan is stored on this device and works offline. Signing in does not upload or change
                your trips.
              </AppText>
            </View>
          </View>
          <Button
            label="Sign in with Google"
            icon="login"
            disabled={status === 'initializing'}
            onPress={() => router.push('/auth/sign-in')}
            testID="account-sign-in"
          />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    gap: spacing.xs,
  },
});
