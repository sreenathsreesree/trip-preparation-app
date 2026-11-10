import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { colors, sizes, type ColorToken } from '@/theme';
import type { IconName } from '@/theme/icons';

export interface IconProps {
  name: IconName;
  size?: number;
  tone?: ColorToken;
  /** Raw colour override, e.g. a section tint. */
  color?: string;
}

export function Icon({ name, size = sizes.iconMd, tone = 'textPrimary', color }: IconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color ?? colors[tone]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
