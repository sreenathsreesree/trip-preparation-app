import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

const pattern = require('../../../assets/images/topo-pattern.svg');

/** Decorative topographic contour layer for hero surfaces. Hidden from assistive tech. */
export function TopoBackdrop({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <Image
      source={pattern}
      contentFit="cover"
      style={[StyleSheet.absoluteFill, { opacity }]}
      accessible={false}
      pointerEvents="none"
      transition={0}
    />
  );
}
