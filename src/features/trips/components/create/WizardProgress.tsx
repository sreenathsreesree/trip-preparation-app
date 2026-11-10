import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/ui';
import { colors, durations, radii, spacing } from '@/theme';

function Segment({ active }: { active: boolean }) {
  const fill = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    fill.set(withTiming(active ? 1 : 0, { duration: durations.base }));
  }, [active, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));

  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, style]} />
    </View>
  );
}

export function WizardProgress({ step, total }: { step: number; total: number }) {
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step + 1} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step + 1 }}
    >
      <AppText variant="label" tone="textMuted">
        Step {step + 1} / {total}
      </AppText>
      <View style={styles.segments}>
        {Array.from({ length: total }, (_, index) => (
          <Segment key={index} active={index <= step} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  segmentFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
});
