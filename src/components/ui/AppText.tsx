import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, typography, type ColorToken, type TypographyVariant } from '@/theme';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: ColorToken;
  align?: TextStyle['textAlign'];
}

/** Typography primitive: every piece of text in the app goes through this. */
export function AppText({
  variant = 'body',
  tone = 'textPrimary',
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: colors[tone] }, align ? { textAlign: align } : null, style]}
    />
  );
}
