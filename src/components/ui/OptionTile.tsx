import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export interface OptionTileProps {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  layout?: 'tile' | 'chip';
  /** Grouped options behave like radio buttons. */
  role?: 'radio' | 'button';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Selectable option used for transport modes (tiles) and categories (chips). */
export function OptionTile({
  label,
  icon,
  selected,
  onPress,
  layout = 'tile',
  role = 'radio',
  style,
  testID,
}: OptionTileProps) {
  const isTile = layout === 'tile';
  return (
    <PressableScale
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: role === 'radio' ? selected : undefined }}
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      pressedScale={0.95}
      style={[isTile ? styles.tile : styles.chip, selected && styles.selected, style]}
    >
      <View style={[styles.iconWrap, isTile && styles.iconWrapTile, selected && styles.iconWrapSelected]}>
        <Icon name={icon} size={isTile ? 26 : 18} tone={selected ? 'accent' : 'textSecondary'} />
      </View>
      <AppText variant={isTile ? 'captionStrong' : 'captionStrong'} tone={selected ? 'textPrimary' : 'textSecondary'}>
        {label}
      </AppText>
      {isTile && selected ? (
        <View style={styles.check}>
          <Icon name="check" size={12} tone="textOnAccent" />
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapTile: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  iconWrapSelected: {
    backgroundColor: 'transparent',
  },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
