import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { impactFeedback } from '@/lib/haptics';
import { colors, radii, sizes, spacing, type ColorToken } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<
  ButtonVariant,
  { background: string; pressed: string; border: string; text: ColorToken }
> = {
  primary: {
    background: colors.accent,
    pressed: '#A6E05A',
    border: colors.accent,
    text: 'textOnAccent',
  },
  secondary: {
    background: colors.surfaceRaised,
    pressed: colors.surfacePressed,
    border: colors.borderStrong,
    text: 'textPrimary',
  },
  ghost: {
    background: 'transparent',
    pressed: colors.accentSoft,
    border: 'transparent',
    text: 'accent',
  },
  danger: {
    background: colors.dangerSoft,
    pressed: colors.dangerSoft,
    border: colors.danger,
    text: 'danger',
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const palette = VARIANTS[variant];
  const inactive = disabled || loading;
  const iconNode = icon ? (
    <Icon name={icon} size={size === 'sm' ? sizes.iconSm : sizes.iconMd} tone={palette.text} />
  ) : null;

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={() => {
        impactFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        {
          backgroundColor: pressed ? palette.pressed : palette.background,
          borderColor: palette.border,
        },
        fullWidth && styles.fullWidth,
        inactive && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[palette.text]} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'leading' && iconNode}
          <AppText variant={size === 'sm' ? 'captionStrong' : 'bodyStrong'} tone={palette.text}>
            {label}
          </AppText>
          {iconPosition === 'trailing' && iconNode}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  md: {
    minHeight: sizes.buttonHeight,
    paddingHorizontal: spacing.xxl,
  },
  sm: {
    minHeight: sizes.buttonHeightSmall,
    paddingHorizontal: spacing.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.4,
  },
});
