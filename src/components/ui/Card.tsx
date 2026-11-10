import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing, type Spacing } from '@/theme';

import { PressableScale } from './PressableScale';

export type CardVariant = 'default' | 'raised' | 'outline' | 'accent';

export interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  padding?: Spacing;
  style?: StyleProp<ViewStyle>;
  /** When provided the card becomes a button. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Card({
  children,
  variant = 'default',
  padding = 'lg',
  style,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: CardProps) {
  const cardStyle = [styles.base, styles[variant], { padding: spacing[padding] }, style];

  if (onPress) {
    return (
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        pressedScale={0.985}
        style={({ pressed }) => [cardStyle, pressed && styles.pressed]}
      >
        {children}
      </PressableScale>
    );
  }

  return (
    <View testID={testID} style={cardStyle}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  default: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: colors.borderStrong,
  },
  accent: {
    backgroundColor: colors.surface,
    borderColor: colors.accentBorder,
  },
  pressed: {
    borderColor: colors.borderStrong,
  },
});
