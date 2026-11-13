/**
 * Expedition Tech palette.
 *
 * `palette` holds the raw brand colours. Components should use the semantic
 * `colors` tokens below so the visual language can evolve in one place.
 */
export const palette = {
  expeditionCharcoal: '#202832',
  slate: '#34424E',
  signalLime: '#B8F36B',
  glacierBlue: '#9DCBE5',
  iceWhite: '#E8EDF0',
  trailAmber: '#F2B85B',
} as const;

/** Adds an alpha channel to a 6-digit hex colour. */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const channel = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${channel}`;
}

export const colors = {
  // Surfaces, from deepest to most raised.
  background: '#1A2129',
  backgroundElevated: palette.expeditionCharcoal,
  surface: '#28323D',
  surfaceRaised: palette.slate,
  surfacePressed: '#3D4D5A',

  // Lines.
  border: withAlpha(palette.iceWhite, 0.08),
  borderStrong: withAlpha(palette.iceWhite, 0.16),

  // Text.
  textPrimary: palette.iceWhite,
  textSecondary: withAlpha(palette.iceWhite, 0.7),
  textMuted: withAlpha(palette.iceWhite, 0.48),
  textOnAccent: palette.expeditionCharcoal,

  // Brand accents.
  accent: palette.signalLime,
  accentSoft: withAlpha(palette.signalLime, 0.14),
  accentBorder: withAlpha(palette.signalLime, 0.45),
  info: palette.glacierBlue,
  infoSoft: withAlpha(palette.glacierBlue, 0.14),
  warning: palette.trailAmber,
  warningSoft: withAlpha(palette.trailAmber, 0.14),

  // Supporting status colour for destructive actions (not part of the core palette).
  danger: '#F28B7D',
  dangerSoft: withAlpha('#F28B7D', 0.14),

  overlay: withAlpha('#0E1318', 0.72),
  /** Full-screen photo viewer: near-black backdrop, translucent chrome and small badges over photos. */
  photoBackdrop: '#05080B',
  photoChrome: withAlpha('#0E1318', 0.55),
  photoBadge: withAlpha('#0E1318', 0.6),

  // Supporting status hues for inventory and shopping states.
  violet: '#B8A6F2',
  teal: '#6FD6C2',
  neutral: '#8A949C',
} as const;

/**
 * Colours a user can pick for an inventory category. The chosen hex value is
 * stored with the category, so existing entries must never change.
 */
export const categoryPalette = [
  palette.signalLime,
  palette.glacierBlue,
  palette.trailAmber,
  colors.danger,
  colors.violet,
  colors.teal,
  '#D9C49A',
  '#8FCB4A',
  palette.iceWhite,
] as const;

export type ColorToken = keyof typeof colors;
