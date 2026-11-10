import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const segmentWidth = options.length > 0 ? width / options.length : 0;

  const indicatorX = useSharedValue(0);
  const measuredWidth = useRef(0);

  // Jump into place on (re)layout; spring only when the selection changes.
  useEffect(() => {
    if (segmentWidth === 0) return;
    const target = index * segmentWidth;
    if (measuredWidth.current !== segmentWidth) {
      measuredWidth.current = segmentWidth;
      indicatorX.set(target);
    } else {
      indicatorX.set(withSpring(target, { damping: 20, stiffness: 240 }));
    }
  }, [index, segmentWidth, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
  }));

  return (
    <View
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width - 8)}
    >
      {width > 0 ? (
        <Animated.View style={[styles.indicator, { width: segmentWidth }, indicatorStyle]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            testID={`segment-${option.value}`}
            onPress={() => {
              if (!selected) {
                selectionFeedback();
                onChange(option.value);
              }
            }}
            style={styles.segment}
          >
            <AppText variant="captionStrong" tone={selected ? 'textOnAccent' : 'textSecondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
});
