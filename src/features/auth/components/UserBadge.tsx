import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { AuthUser } from '../authService';

export function initialsFor(user: Pick<AuthUser, 'name' | 'email'>): string {
  const source = user.name ?? user.email ?? '';
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const [first = '?', second] = words;
  const letters = second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2);
  return letters.toUpperCase();
}

/** Name, email and initials (no remote avatar, so it works offline). */
export function UserBadge({ user }: { user: AuthUser }) {
  return (
    <View style={styles.row} testID="account-user">
      <View style={styles.avatar}>
        <AppText variant="bodyStrong" tone="textOnAccent">
          {initialsFor(user)}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="h3" numberOfLines={1}>
          {user.name ?? 'Google account'}
        </AppText>
        {user.email ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={1} testID="account-email">
            {user.email}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    gap: spacing.xxs,
  },
});
