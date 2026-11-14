import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface CollapsibleProps {
  title: string;
  icon?: IconName;
  /** One line shown while closed (e.g. "3 notices" or the first tag names). */
  summary?: string;
  /** Optional trailing element in the header (shown open or closed). */
  trailing?: ReactNode;
  initiallyOpen?: boolean;
  children: ReactNode;
  testID?: string;
}

/**
 * A titled section that opens and closes. Content stays mounted only while
 * open, so long pages stay short and quick to scan.
 */
export function Collapsible({ title, icon, summary, trailing, initiallyOpen = false, children, testID }: CollapsibleProps) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.box} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        accessibilityLabel={`${title}${summary && !open ? `, ${summary}` : ''}`}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        {icon ? <Icon name={icon} size={20} tone="accent" /> : null}
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{title}</AppText>
          {summary && !open ? (
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {summary}
            </AppText>
          ) : null}
        </View>
        {trailing}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} tone="textMuted" />
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  body: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
