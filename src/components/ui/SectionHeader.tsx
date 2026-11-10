import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

import { AppText } from './AppText';

export interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  /** Optional trailing element, e.g. a small button. */
  trailing?: ReactNode;
}

export function SectionHeader({ title, eyebrow, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        {eyebrow ? (
          <AppText variant="label" tone="accent">
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="h3" accessibilityRole="header">
          {title}
        </AppText>
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
});
