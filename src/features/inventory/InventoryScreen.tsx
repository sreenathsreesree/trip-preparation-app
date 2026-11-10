import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Card, Icon, Tag } from '@/components/ui';
import { colors, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

const PLANNED: { icon: IconName; text: string }[] = [
  { icon: 'bag-personal-outline', text: 'Catalogue your bags, gear and gadgets once.' },
  { icon: 'repeat', text: 'Reuse them across every trip’s packing list.' },
  { icon: 'scale-balance', text: 'Track what goes into which bag before you leave.' },
];

/**
 * Inventory is a later milestone. This screen states that plainly and offers no
 * controls, so nothing here pretends to work.
 */
export function InventoryScreen() {
  return (
    <Screen testID="inventory-screen">
      <ScreenHeader eyebrow="Gear locker" title="Inventory" />
      <Card variant="outline" padding="xl">
        <View style={styles.content}>
          <Tag label="Not available yet" icon="progress-clock" color={colors.warning} />
          <AppText variant="h3">Your reusable gear list is on the way</AppText>
          <AppText variant="body" tone="textSecondary">
            Inventory isn&apos;t part of this version of the app. For now, add packing items
            directly to each trip&apos;s checklist. When inventory arrives, you&apos;ll be able to:
          </AppText>
          <View style={styles.list}>
            {PLANNED.map((item) => (
              <View key={item.text} style={styles.row}>
                <Icon name={item.icon} tone="info" />
                <AppText variant="body" tone="textSecondary" style={styles.flex}>
                  {item.text}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
