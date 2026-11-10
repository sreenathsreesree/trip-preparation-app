import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing, withAlpha } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface TagProps {
  label: string;
  icon?: IconName;
  /** Accent colour for text, icon and tinted background. */
  color?: string;
}

/** Small read-only metadata pill (not interactive). */
export function Tag({ label, icon, color = colors.textSecondary }: TagProps) {
  return (
    <View style={[styles.tag, { backgroundColor: withAlpha(color.slice(0, 7), 0.12) }]}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <AppText variant="captionStrong" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
