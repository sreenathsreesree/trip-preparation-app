import type { TextStyle } from 'react-native';

/**
 * Font family names registered in the root layout via `useFonts`.
 * Custom families encode their weight, so `fontWeight` is intentionally not set
 * (Android picks the wrong face when both are combined).
 */
export const fontFamilies = {
  headingMedium: 'SpaceGrotesk_500Medium',
  headingSemiBold: 'SpaceGrotesk_600SemiBold',
  headingBold: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamilies.headingBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
  },
  h1: {
    fontFamily: fontFamilies.headingBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: fontFamilies.headingSemiBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fontFamilies.headingSemiBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  title: {
    fontFamily: fontFamilies.headingMedium,
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyStrong: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
    lineHeight: 18,
  },
  captionStrong: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  /** Small uppercase "instrument panel" label. */
  label: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  /** Large numeric read-outs (countdowns, percentages). */
  metric: {
    fontFamily: fontFamilies.headingBold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
