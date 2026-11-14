import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

const LINKS: { key: string; label: string; icon: IconName; testID: string; href: (tripId: string) => Href }[] = [
  { key: 'clothing', label: 'Clothing', icon: 'tshirt-crew-outline', testID: 'trip-clothing', href: (tripId) => ({ pathname: '/trips/[tripId]/clothing', params: { tripId } }) },
  { key: 'journal', label: 'Journal', icon: 'book-open-page-variant-outline', testID: 'journal-open', href: (tripId) => ({ pathname: '/trips/[tripId]/journal', params: { tripId } }) },
  { key: 'memories', label: 'Memories', icon: 'image-multiple-outline', testID: 'trip-memories', href: (tripId) => ({ pathname: '/trips/[tripId]/gallery', params: { tripId } }) },
  { key: 'group', label: 'Group Trip', icon: 'account-group-outline', testID: 'trip-group', href: (tripId) => ({ pathname: '/trips/[tripId]/group', params: { tripId } }) },
  { key: 'mine', label: 'My Trip', icon: 'lock-outline', testID: 'trip-mine', href: (tripId) => ({ pathname: '/trips/[tripId]/mine', params: { tripId } }) },
];

/** Compact links to the trip's other spaces, instead of a card for each. */
export function QuickLinks({ tripId }: { tripId: string }) {
  return (
    <View style={styles.grid} testID="trip-quick-links">
      {LINKS.map((link) => (
        <Pressable
          key={link.key}
          accessibilityRole="link"
          accessibilityLabel={link.label}
          onPress={() => router.push(link.href(tripId))}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
          testID={link.testID}
        >
          <Icon name={link.icon} size={22} tone="accent" />
          <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
            {link.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
