import { DarkTheme, type Theme } from 'expo-router';

import { colors } from './colors';
import { fontFamilies } from './typography';

/** Navigation theme so native containers never flash a light background. */
export const navigationTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.backgroundElevated,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.warning,
  },
  fonts: {
    ...DarkTheme.fonts,
    regular: { fontFamily: fontFamilies.body, fontWeight: '400' },
    medium: { fontFamily: fontFamilies.bodyMedium, fontWeight: '500' },
    bold: { fontFamily: fontFamilies.bodySemiBold, fontWeight: '600' },
    heavy: { fontFamily: fontFamilies.headingBold, fontWeight: '700' },
  },
};
