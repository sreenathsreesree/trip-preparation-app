import { useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SPRING = { damping: 18, stiffness: 320, mass: 0.6 } as const;

type StyleInput = StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleInput;
  /** Scale applied while pressed. */
  pressedScale?: number;
}

/** Pressable with a subtle spring "squish" — the base for tappable surfaces. */
export function PressableScale({
  style,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const resolvedStyle = typeof style === 'function' ? style({ pressed }) : style;

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          setPressed(true);
          scale.set(withSpring(pressedScale, SPRING));
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        scale.set(withSpring(1, SPRING));
        onPressOut?.(event);
      }}
      style={[resolvedStyle, animatedStyle]}
    />
  );
}
