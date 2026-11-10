import { StyleSheet } from 'react-native';

import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, sizes, type ColorToken } from '@/theme';
import type { IconName } from '@/theme/icons';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: IconName;
  /** Required: icon-only controls must be labelled for screen readers. */
  accessibilityLabel: string;
  onPress: () => void;
  tone?: ColorToken;
  variant?: 'filled' | 'plain' | 'accent';
  /** `sm` is visually compact but keeps a 44pt touch area via hit slop. */
  size?: 'md' | 'sm';
  disabled?: boolean;
  testID?: string;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  tone = 'textPrimary',
  variant = 'filled',
  size = 'md',
  disabled = false,
  testID,
}: IconButtonProps) {
  const small = size === 'sm';
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={small ? 12 : 8}
      pressedScale={0.92}
      onPress={() => {
        selectionFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        variant === 'filled' && styles.filled,
        variant === 'accent' && styles.accent,
        pressed && (variant === 'accent' ? styles.accentPressed : styles.pressed),
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={small ? sizes.iconSm + 2 : sizes.iconMd} tone={tone} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: {
    width: 34,
    height: 34,
  },
  filled: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accent: {
    backgroundColor: colors.accent,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  accentPressed: {
    backgroundColor: colors.accentBorder,
  },
  disabled: {
    opacity: 0.35,
  },
});
