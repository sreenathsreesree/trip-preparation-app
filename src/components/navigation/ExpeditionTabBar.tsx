import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { AppText } from '@/components/ui/AppText';
import { Icon } from '@/components/ui/Icon';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, sizes, spacing, springs } from '@/theme';
import type { IconName } from '@/theme/icons';

export interface TabIconSet {
  icon: IconName;
  activeIcon: IconName;
}

export interface ExpeditionTabBarProps extends BottomTabBarProps {
  icons: Record<string, TabIconSet>;
}

const INDICATOR_WIDTH = 28;

/** Expedition Tech bottom bar with a sliding Signal Lime indicator. */
export function ExpeditionTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  icons,
}: ExpeditionTabBarProps) {
  const [width, setWidth] = useState(0);
  const routes = state.routes;
  const tabWidth = routes.length > 0 ? width / routes.length : 0;

  const indicatorX = useSharedValue(0);
  const measuredWidth = useRef(0);

  // Jump into place on (re)layout; spring only when the selected tab changes.
  useEffect(() => {
    if (tabWidth === 0) return;
    const target = state.index * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2;
    if (measuredWidth.current !== tabWidth) {
      measuredWidth.current = tabWidth;
      indicatorX.set(target);
    } else {
      indicatorX.set(withSpring(target, springs.indicator));
    }
  }, [state.index, tabWidth, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
  }));

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View
        style={styles.row}
        role="tablist"
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? <Animated.View style={[styles.indicator, indicatorStyle]} /> : null}
        {routes.map((route, index) => {
          const focused = index === state.index;
          const options = descriptors[route.key]?.options;
          const label = typeof options?.title === 'string' ? options.title : route.name;
          const iconSet = icons[route.name];

          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              selectionFeedback();
              navigateToTab(route.key);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              testID={`tab-${route.name}`}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.tab}
            >
              {iconSet ? (
                <Icon
                  name={focused ? iconSet.activeIcon : iconSet.icon}
                  size={sizes.iconLg}
                  tone={focused ? 'accent' : 'textMuted'}
                />
              ) : null}
              <AppText
                variant="label"
                tone={focused ? 'textPrimary' : 'textMuted'}
                style={styles.label}
                numberOfLines={1}
              >
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: sizes.maxContentWidth,
    alignSelf: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: INDICATOR_WIDTH,
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: sizes.tabBarHeight - spacing.sm,
    paddingTop: spacing.sm,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.8,
  },
});
