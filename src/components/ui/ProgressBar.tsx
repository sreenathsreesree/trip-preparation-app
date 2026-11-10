import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, durations, radii } from '@/theme';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  accessibilityLabel?: string;
}

export function ProgressBar({
  value,
  color = colors.accent,
  height = 6,
  accessibilityLabel,
}: ProgressBarProps) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const progress = useSharedValue(clamped);

  useEffect(() => {
    progress.set(withTiming(clamped, { duration: durations.slow }));
  }, [clamped, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      <Animated.View
        style={[styles.fill, { backgroundColor: color, borderRadius: height / 2 }, fillStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.border,
    borderRadius: radii.pill,
  },
  fill: {
    height: '100%',
  },
});
