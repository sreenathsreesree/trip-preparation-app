import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui';
import { colors, radii, withAlpha } from '@/theme';
import type { IconName } from '@/theme/icons';

import { illustrationFor, type ItemImage as ItemImageValue } from '../model';

export interface ItemImageProps {
  image: ItemImageValue | null | undefined;
  /** Placeholder icon/colour when there is no image (usually the category's). */
  fallbackIcon: IconName;
  fallbackColor: string;
  size?: number | '100%';
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Item picture with a fixed priority:
 * 1. the user's own photo, 2. an illustration they chose, 3. a suggested
 * illustration they approved, 4. the category placeholder.
 * Illustrations are clearly generic icons, never product photos. A missing
 * photo file falls back to the placeholder instead of showing a broken image.
 */
export function ItemImage({ image, fallbackIcon, fallbackColor, size = 56, rounded = radii.md, style }: ItemImageProps) {
  const [failed, setFailed] = useState(false);
  const dimension = size === '100%' ? { width: '100%' as const, aspectRatio: 1 } : { width: size, height: size };
  const iconSize = typeof size === 'number' ? Math.round(size * 0.45) : 48;

  if (image?.source === 'photo' && !failed) {
    return (
      <Image
        source={{ uri: image.uri }}
        contentFit="cover"
        transition={120}
        onError={() => setFailed(true)}
        style={[dimension, { borderRadius: rounded, backgroundColor: colors.surfaceRaised }, style as never]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const illustration = image && image.source !== 'photo' ? illustrationFor(image.uri) : null;
  const icon = illustration?.icon ?? fallbackIcon;
  return (
    <View
      style={[
        styles.tile,
        dimension,
        {
          borderRadius: rounded,
          backgroundColor: withAlpha(fallbackColor.slice(0, 7), illustration ? 0.22 : 0.1),
          borderStyle: illustration ? 'solid' : 'dashed',
          borderColor: withAlpha(fallbackColor.slice(0, 7), illustration ? 0.4 : 0.35),
        },
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={illustration ? fallbackColor : withAlpha(fallbackColor.slice(0, 7), 0.7)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
