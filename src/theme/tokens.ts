/** 4pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const sizes = {
  /** Minimum touch target recommended by both platform guidelines. */
  touchTarget: 44,
  buttonHeight: 52,
  buttonHeightSmall: 40,
  inputHeight: 52,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  tabBarHeight: 64,
  maxContentWidth: 640,
} as const;

export const durations = {
  fast: 120,
  base: 220,
  slow: 380,
} as const;

export type Spacing = keyof typeof spacing;
