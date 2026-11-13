import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

export const MAX_ZOOM = 5;

/** Clamps a pan offset so a zoomed image cannot be dragged off screen. Pure (exported for tests). */
export function clampOffset(offset: number, scale: number, extent: number): number {
  'worklet';
  const limit = Math.max(0, (extent * scale - extent) / 2);
  return Math.min(limit, Math.max(-limit, offset));
}

/**
 * The full image, whole and uncropped ("contain"), with pinch-to-zoom,
 * double-tap zoom and panning while zoomed. Not zoomed, horizontal swipes go
 * to the pager (the pan only activates once zoomed).
 */
export function ZoomableImage({ uri, width, height, label, onZoomChange }: { uri: string; width: number; height: number; label: string; onZoomChange?: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const report = (zoomed: boolean) => onZoomChange?.(zoomed);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(MAX_ZOOM, Math.max(1, savedScale.get() * e.scale)));
    })
    .onEnd(() => {
      savedScale.set(scale.get());
      if (scale.get() <= 1.01) {
        scale.set(withTiming(1));
        savedScale.set(1);
        x.set(withTiming(0));
        y.set(withTiming(0));
        savedX.set(0);
        savedY.set(0);
      }
    })
    .runOnJS(true)
    .onFinalize(() => report(savedScale.get() > 1));

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_, manager) => {
      if (savedScale.get() > 1) manager.activate();
      else manager.fail();
    })
    .onUpdate((e) => {
      x.set(clampOffset(savedX.get() + e.translationX, scale.get(), width));
      y.set(clampOffset(savedY.get() + e.translationY, scale.get(), height));
    })
    .onEnd(() => {
      savedX.set(x.get());
      savedY.set(y.get());
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd(() => {
      const next = savedScale.get() > 1 ? 1 : 2.5;
      scale.set(withTiming(next));
      savedScale.set(next);
      x.set(withTiming(0));
      y.set(withTiming(0));
      savedX.set(0);
      savedY.set(0);
      report(next > 1);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={label} cachePolicy="memory-disk" />
      </Animated.View>
    </GestureDetector>
  );
}
